// Shared review flow used by design-review / code-review / fix-review tool handlers.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §3 / §4 / §5

import { createHash, randomBytes } from "node:crypto";
import type { ResolvedConfig } from "./config.js";
import { resolveProjectPath } from "./config.js";
import {
  BreakerEngine,
  type BreakerState,
  type BreakerTriggered,
} from "./circuit-breakers.js";
import { estimateTokensFromChars } from "./context-monitor.js";
import { planDrift, renderDriftPreface } from "./drift-detector.js";
import { parseCodexOutput, type ParseResult } from "./output-parser.js";
import { PromptRenderer, type PromptVars } from "./prompt-renderer.js";
import type {
  PersistedProviderSession,
  ProviderRunResult,
  ProviderSession,
  ReviewProvider,
} from "./review-provider.js";
import { ThreadManager } from "./thread-manager.js";
import { providerKindForStage } from "./providers/factory.js";
import type {
  ProviderKind,
  ReviewEnvelope,
  ReviewStage,
  RoundHistoryEntry,
  ThreadHistoryEntry,
  ThreadState,
} from "./types.js";

/**
 * Server-authoritative review id. Codex cannot know this value when generating its
 * envelope text, so any value Codex writes is discarded by the flow and replaced
 * with the output of this generator.
 *
 * Format: `rev_<sanitized-design-id>_<stage>_<round>_<4-hex>` per design §3.0 doc-sync.
 */
function generateReviewId(
  designId: string,
  stage: ReviewStage,
  round: number,
): string {
  const sanitized = designId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const short = randomBytes(2).toString("hex");
  return `rev_${sanitized}_${stage}_${round}_${short}`;
}

export interface FlowDependencies {
  config: ResolvedConfig;
  configBaseDir: string;
  /** Review backend registry behind the raw-turn boundary (design §4.7). The flow resolves the
   * stage's provider KIND per call (flow matrix, collaboration.md §1.D: per-stage derivation;
   * fix inherits the session's provider_kind) and asks this registry for the backend. */
  providerFor: (kind: ProviderKind) => ReviewProvider;
  threadManager: ThreadManager;
  promptRenderer: PromptRenderer;
  breakers: BreakerEngine;
  /** External breaker state accumulated across calls within the same orchestrator. */
  breakerState: BreakerState;
}

export interface FlowInput {
  stage: ReviewStage;
  designId: string;
  /** Files to inject and run drift detection over. */
  designDocPaths: string[];
  /** Other context files to attach without drift tracking. */
  fileBlocks: Array<{ label: string; path: string }>;
  /** Variables substituted into the template body. */
  promptVars: PromptVars;
  /** Whether the caller already supplied previous_round_resolved (only relevant for stage='fix'). */
  hasPreviousRoundResolved: boolean;
  /** Caller may force opening a fresh thread (e.g. design_id reset). */
  forceNewThread: boolean;
  /**
   * For fix stage: lines added in this round's fix attempt. The flow accumulates this into
   * state.scope_drift_lines_total and trips the scope_drift breaker if the threshold is crossed.
   * Other stages (design / code) should pass undefined (caller's responsibility).
   */
  fixDiffLines?: number;
  /** Manual provider two-phase submit: path to a human-pasted verdict.json (design §4.7 C2).
   * When set, ManualProvider ingests it as a turn instead of preparing a new prompt. */
  manualVerdictPath?: string;
}

export interface FlowResult {
  ok: boolean;
  envelope?: ReviewEnvelope;
  /** Present for every real review turn. Omitted on the manual `awaitingManual` control branch
   * (no parse ran) — see design §4.7 C2. */
  parseResult?: ParseResult;
  /** Breaker triggered — caller should stop and report to user. */
  breakerTripped?: BreakerTriggered;
  /** Warnings to surface to the user. */
  warnings: string[];
  /** True if this call rebuilt the thread because previous round saturated context. */
  didRebuildThread?: boolean;
  /** Manual two-phase prepare (design §4.7 C2): provider wrote a prompt for a human/external
   * reviewer and is awaiting a verdict. NO parse / breaker / usage / round write happened;
   * the submit call re-enters with the verdict. codex / claude never set this. */
  awaitingManual?: { prompt_path: string; verdict_path_expected: string };
}

export async function runReviewFlow(
  deps: FlowDependencies,
  input: FlowInput,
): Promise<FlowResult> {
  const { config, configBaseDir, providerFor, threadManager, promptRenderer, breakers, breakerState } =
    deps;
  const cb = config.circuit_breakers;

  const release = threadManager.acquireLock(input.designId);
  // Opened below; released in the outer finally so closeSession runs on EVERY exit path
  // (normal turn, parse-failure, breaker, awaiting_manual, throw) — slice-2 review carryover.
  let session: ProviderSession | null = null;
  // The backend that opened `session` (resolved per call inside the try — §1.D); the finally
  // must close the session against the SAME backend instance.
  let activeProvider: ReviewProvider | null = null;
  try {
    // ---------- 1) Load existing state ----------
    //
    // ALWAYS read state — even when force_new_thread=true. Per design pre-review RC
    // c_preserve_thread_state: force_new_thread replaces the active SDK thread but must
    // PRESERVE rounds counters / history / design_doc_files / scope_drift_lines_total /
    // tokens_used_estimate_total so that max_review_rounds / scope_drift breakers and
    // audit chain stay continuous across thread boundaries within the same design_id.
    const existingState = threadManager.read(input.designId);

    // ---------- 1.A) Resolve this call's review backend (flow matrix §1.D) ----------
    // `review.provider = manual` short-circuits EVERY stage — including a fix whose session
    // was opened under codex/claude (code r1 i_fix_manual_short_circuit): switching the repo
    // to manual mid-thread goes manual via the provider_switch rebuild, exactly like the
    // pre-flow-matrix behavior. Otherwise design / code derive from the [collaboration]
    // owner keys (legacy: review.provider), and fix INHERITS the live session's
    // provider_kind — the reviewer who raised the findings re-judges the fix — falling back
    // to the code-stage derivation when no live session.
    const stageKind: ProviderKind =
      config.review.provider === "manual"
        ? "manual"
        : input.stage === "fix" && existingState && !existingState.archived
          ? existingState.provider_kind
          : providerKindForStage(input.stage, config);
    const provider = providerFor(stageKind);
    activeProvider = provider;

    // ---------- 2) Hydrate breakerState from persisted ThreadState ----------
    // Per task §6.3 + code_review round 4 c_round_breaker_not_hydrated_from_state:
    // `breakerState.rounds` and `scope_drift_lines` MUST be hydrated from per-design_id
    // persisted state, so that:
    //   (a) max_review_rounds / scope_drift survive MCP server restart;
    //   (b) two design_ids served by the same process do not share counters
    //       (each call resets to that design_id's persisted values).
    // Streak counters (codex/parser failure, context_exhausted_triggered) are
    // event-window state and remain process-local — not hydrated.
    if (existingState) {
      breakerState.rounds.design_review = existingState.rounds.design_review;
      breakerState.rounds.code_review = existingState.rounds.code_review;
      breakerState.rounds.fix_review = existingState.rounds.fix_review;
      breakerState.scope_drift_lines = existingState.scope_drift_lines_total;
    } else {
      breakerState.rounds.design_review = 0;
      breakerState.rounds.code_review = 0;
      breakerState.rounds.fix_review = 0;
      breakerState.scope_drift_lines = 0;
    }
    let preservedScopeDriftLines = breakerState.scope_drift_lines;
    if (input.stage === "fix" && input.fixDiffLines !== undefined && input.fixDiffLines > 0) {
      const tripped = breakers.recordScopeDrift(breakerState, input.fixDiffLines);
      preservedScopeDriftLines = breakerState.scope_drift_lines;
      if (tripped) {
        return {
          ok: false,
          parseResult: {
            ok: false,
            reason: "schema_violation",
            detail: tripped.message,
            raw_excerpt: "",
          },
          breakerTripped: tripped,
          warnings: [tripped.message],
        };
      }
    }

    // ---------- 3) Pre-decide rebuild + drift + prompt (no SDK yet) ----------
    // Doing render BEFORE touching the Codex SDK so an `AllowedDocRootViolation` (or
    // any other prompt-render error) surfaces without spending an SDK init / network call.
    //
    // Two rebuild triggers (both replace SDK thread but preserve design state):
    //   1. caller-driven `input.forceNewThread === true` (context_exhausted recovery)
    //   2. context-driven `state.context_usage_pct >= context_force_new_thread_pct`
    let didRebuildThisCall = false;
    let rebuildReason: ThreadHistoryEntry["reason"] | null = null;
    let coldStartPreface = "";
    if (existingState && !existingState.archived) {
      // Provider switch (Q7) is a hard invalidation and takes priority: a session opened by
      // another provider's backend cannot be resumed (no cross-provider thread/history reuse).
      // Under the flow matrix (§1.D) this also covers the intended per-stage reviewer change
      // within one design_id (e.g. design reviewed by codex, code reviewed by claude): the
      // stage's derived kind differs from the session's → fresh session + cold-start preface,
      // with rounds/drift/token counters preserved. Fix inherits the session's kind (stageKind
      // above) and therefore only rebuilds here on a switch to review.provider=manual (the
      // manual short-circuit outranks inheritance — i_fix_manual_short_circuit).
      if (existingState.provider_kind !== stageKind) {
        didRebuildThisCall = true;
        rebuildReason = "provider_switch";
      } else if (input.forceNewThread) {
        didRebuildThisCall = true;
        rebuildReason = "force_new_thread";
      } else if (
        existingState.context_usage_pct >= cb.context_force_new_thread_pct
      ) {
        didRebuildThisCall = true;
        rebuildReason = "context_force_new_thread_pct";
      }
      if (didRebuildThisCall && rebuildReason) {
        const recent = existingState.rounds.history.slice(-3);
        coldStartPreface = renderColdStartPreface(
          recent,
          existingState.context_usage_pct,
          rebuildReason,
        );
      }
    }

    const drift = planDrift(existingState, input.designDocPaths, (p) =>
      resolveProjectPath(config, configBaseDir, p),
    );
    const driftPreface = renderDriftPreface(drift);

    const body = promptRenderer.render({
      stage: input.stage,
      vars: input.promptVars,
      fileBlocks: input.fileBlocks,
      driftPreface,
    });
    const prompt = coldStartPreface ? `${coldStartPreface}\n\n${body}` : body;

    // ---------- 4) Now touch the provider: open (resume or fresh) the review session ----------
    // The orchestrator owns the resume-vs-fresh DECISION; it passes `prior` only when the
    // session should be resumed. Rebuild (provider_switch / force_new_thread / context) or a
    // missing/archived state → prior=undefined → provider opens a fresh session.
    const projectRoot = resolveProjectPath(config, configBaseDir, ".");
    const shouldResume =
      !didRebuildThisCall && existingState !== null && !existingState.archived;
    let prior: PersistedProviderSession | undefined = undefined;
    if (shouldResume && existingState) {
      prior = {
        provider_kind: existingState.provider_kind,
        external_session_id: existingState.thread_id,
        context_usage_source:
          existingState.provider_kind === "codex" ? "native" : "estimated",
        created_at: existingState.thread_created_at,
      };
    }
    session = await provider.openSession(input.stage, input.designId, prior);

    // Round this review will record (matches the post-parse `round` below); manual uses it
    // for prompt/verdict file naming.
    const prospectiveRound = currentRoundFor(existingState, input.stage) + 1;

    // ---------- 5) Run one provider turn (raw-turn boundary, design §4.7) ----------
    let providerResult: ProviderRunResult;
    try {
      providerResult = await provider.runTurn(
        {
          text: prompt,
          workingDirectory: projectRoot,
          designId: input.designId,
          stage: input.stage,
          round: prospectiveRound,
          manualVerdictPath: input.manualVerdictPath,
        },
        session,
      );
    } catch (err) {
      const tripped = breakers.recordCodexFailure(breakerState);
      const warnings = [
        `review provider '${provider.kind}' turn failed: ${(err as Error).message}`,
      ];
      if (tripped) {
        return {
          ok: false,
          parseResult: {
            ok: false,
            reason: "non_json",
            detail: (err as Error).message,
            raw_excerpt: "",
          },
          breakerTripped: tripped,
          warnings,
          didRebuildThread: didRebuildThisCall,
        };
      }
      throw err;
    }

    // Manual two-phase control branch (design §4.7 C2 / Q10): awaiting_manual does NOT flow
    // into output-parser / breaker / usage / round write. Return it verbatim; the submit call
    // re-enters with the human verdict. codex / claude always return kind:"turn".
    if (providerResult.kind === "awaiting_manual") {
      return {
        ok: true,
        warnings: [
          `review provider '${provider.kind}' is awaiting a manual verdict; ` +
            `prompt written to ${providerResult.prompt_path}`,
        ],
        awaitingManual: {
          prompt_path: providerResult.prompt_path,
          verdict_path_expected: providerResult.verdict_path_expected,
        },
        didRebuildThread: didRebuildThisCall,
      };
    }

    // From here providerResult.kind === "turn": a real review turn to parse + account for.
    const runResult = {
      text: providerResult.text,
      usage: providerResult.usage,
      providerSessionId: providerResult.provider_session_id,
    };

    // Manual submit idempotency (design §4.7): resubmitting the SAME verdict returns the
    // previously recorded envelope verbatim — same review_id, no round bump, no breaker/state
    // mutation. Only manual is idempotent this way (human-driven retries); codex/claude turns
    // are always fresh.
    const manualVerdictSha =
      provider.kind === "manual"
        ? createHash("sha256").update(runResult.text).digest("hex")
        : null;
    if (
      manualVerdictSha !== null &&
      existingState?.last_manual_submit?.verdict_sha === manualVerdictSha
    ) {
      return {
        ok: true,
        envelope: existingState.last_manual_submit.envelope,
        warnings: [
          "idempotent manual resubmit: identical verdict already ingested; " +
            "returning the recorded envelope (no new round).",
        ],
        didRebuildThread: didRebuildThisCall,
      };
    }

    breakers.recordCodexSuccess(breakerState);

    // ---------- 7) Parse Codex output ----------
    const parseResult = parseCodexOutput(runResult.text, {
      stage: input.stage,
      config,
      hasPreviousRoundResolved: input.hasPreviousRoundResolved,
    });

    if (!parseResult.ok) {
      const tripped = breakers.recordParserFailure(breakerState);
      return {
        ok: false,
        parseResult,
        ...(tripped ? { breakerTripped: tripped } : {}),
        warnings: [
          `output-parser rejected Codex output (${parseResult.reason}): ${parseResult.detail}`,
        ],
        didRebuildThread: didRebuildThisCall,
      };
    }
    breakers.recordParserSuccess(breakerState);

    // ---------- 8) Round counter breaker ----------
    const roundBreakerTripped = breakers.bumpRound(breakerState, input.stage);

    // ---------- 9) Build/refresh state + authoritative envelope override ----------
    //
    // Codex generates `thread_id` and `review_id` blindly because nothing in the
    // prompt context exposes the SDK's runtime Thread.id or our intended review_id
    // format. Whatever Codex put there is discarded; server is the single source of
    // truth. (Self-test 2026-05-05 surfaced this; see design §3.0 + task card
    // methodology-codex-review-bridge-thread-id-consistency-implement.)
    //
    // Per design pre-review RC c_preserve_thread_state: rebuild paths replace
    // `thread_id` + append `thread_history` but keep all other state fields so that
    // round counters / history / drift / token totals span SDK thread boundaries.
    let state: ThreadState;
    if (existingState && !existingState.archived) {
      state = existingState;
      if (didRebuildThisCall && rebuildReason) {
        state.thread_history = [
          ...(state.thread_history ?? []),
          {
            thread_id: state.thread_id,
            abandoned_at_round: {
              design_review: state.rounds.design_review,
              code_review: state.rounds.code_review,
              fix_review: state.rounds.fix_review,
            },
            abandoned_at: new Date().toISOString(),
            reason: rebuildReason,
          },
        ];
        state.thread_id = runResult.providerSessionId;
        state.thread_created_at = new Date().toISOString();
        // On provider_switch the kind changes; on force/context rebuild it is unchanged.
        state.provider_kind = provider.kind;
      }
    } else {
      state = threadManager.newState(
        input.designId,
        runResult.providerSessionId,
        provider.kind,
      );
      state.scope_drift_lines_total = preservedScopeDriftLines;
    }
    const round = currentRoundFor(state, input.stage) + 1;
    const finalEnvelope: ReviewEnvelope = {
      ...parseResult.envelope,
      thread_id: runResult.providerSessionId,
      review_id: generateReviewId(input.designId, input.stage, round),
    };
    // context_usage_pct is orchestrator-authoritative. When the provider supplies its own
    // estimate (claude: input_tokens / context_window), it overrides whatever the model
    // emitted in the envelope — the model cannot reliably self-report its context usage.
    // codex leaves usage.context_usage_pct undefined, keeping the codex-native envelope value.
    if (runResult.usage.context_usage_pct !== undefined) {
      finalEnvelope.context_usage_pct = runResult.usage.context_usage_pct;
    }
    const tokens =
      runResult.usage.total ??
      estimateTokensFromChars(prompt.length + runResult.text.length);
    const historyEntry: RoundHistoryEntry = {
      review_id: finalEnvelope.review_id,
      stage: input.stage,
      round,
      verdict: finalEnvelope.verdict,
      compact_summary: finalEnvelope.compact_summary_for_round,
      tokens_used_estimate: tokens,
      ended_at: new Date().toISOString(),
    };
    state = threadManager.updateDesignDocFiles(state, drift.nextDesignDocFiles);
    state = threadManager.recordRound(state, historyEntry);
    state.context_usage_pct = finalEnvelope.context_usage_pct;
    // breakerState.scope_drift_lines was bumped above (fix stage); persist.
    state.scope_drift_lines_total = breakerState.scope_drift_lines;
    // Record the manual verdict identity so an identical resubmit short-circuits idempotently.
    if (manualVerdictSha !== null) {
      state.last_manual_submit = { verdict_sha: manualVerdictSha, envelope: finalEnvelope };
    }

    // ---------- 10) Context-exhausted check (post rebuild) ----------
    const warnings = [...parseResult.warnings];
    let contextExhaustedTrip: BreakerTriggered | null = null;
    if (didRebuildThisCall && state.context_usage_pct >= cb.context_warn_pct) {
      contextExhaustedTrip = breakers.triggerContextExhausted(breakerState);
      warnings.push(contextExhaustedTrip.message);
    } else if (
      !didRebuildThisCall &&
      state.context_usage_pct >= cb.context_warn_pct &&
      state.context_usage_pct < cb.context_force_new_thread_pct
    ) {
      warnings.push(
        `context_usage_pct=${state.context_usage_pct.toFixed(2)} crossed warn=${cb.context_warn_pct}; ` +
          `next call may rebuild thread.`,
      );
    } else if (!didRebuildThisCall && state.context_usage_pct >= cb.context_force_new_thread_pct) {
      warnings.push(
        `context_usage_pct=${state.context_usage_pct.toFixed(2)} >= force-rebuild=${cb.context_force_new_thread_pct}; ` +
          `next call will rebuild thread (force-rebuild).`,
      );
    }

    threadManager.write(state);

    // Pick the most relevant breaker to surface (priority: scope_drift > context_exhausted > round).
    const breakerTripped = contextExhaustedTrip ?? roundBreakerTripped;

    return {
      ok: true,
      envelope: finalEnvelope,
      parseResult,
      ...(breakerTripped ? { breakerTripped } : {}),
      warnings,
      didRebuildThread: didRebuildThisCall,
    };
  } finally {
    if (session && activeProvider) activeProvider.closeSession(session);
    release();
  }
}

function currentRoundFor(state: ThreadState | null, stage: ReviewStage): number {
  if (!state) return 0;
  if (stage === "design") return state.rounds.design_review;
  if (stage === "code") return state.rounds.code_review;
  return state.rounds.fix_review;
}

function renderColdStartPreface(
  recent: RoundHistoryEntry[],
  oldUsagePct: number,
  reason: ThreadHistoryEntry["reason"],
): string {
  const reasonLine =
    reason === "force_new_thread"
      ? `caller 主动设置 force_new_thread=true（context_exhausted 恢复路径）；旧 thread context_usage_pct=${oldUsagePct.toFixed(2)} 时被替换。`
      : reason === "provider_switch"
        ? `本阶段的 reviewer 与旧 session 的 provider 不同（Q7 review.provider 切换，或 §1.D flow-matrix 按阶段派生）：旧 provider 的 session 作废，本轮起用新 provider 的全新 session（不跨 provider 复用 thread/history）。`
        : `旧 thread context_usage_pct=${oldUsagePct.toFixed(2)} 已超过 force-rebuild 阈值，自动替换。`;
  const lines = [
    "## Thread 重建后的冷启动上下文（design §4.4）",
    reasonLine,
    `下方是最近 ${recent.length} 轮 review 的 compact_summary，请基于此继续 review，不要把已记录的结论再发现一次：`,
    "",
  ];
  for (const r of recent) {
    lines.push(`### [${r.stage} round ${r.round}] verdict=${r.verdict}`);
    lines.push(r.compact_summary);
    lines.push("");
  }
  return lines.join("\n");
}
