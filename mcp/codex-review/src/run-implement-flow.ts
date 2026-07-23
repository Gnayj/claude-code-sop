// codex_implement proposal-mode flow (design ccsop-codex-implement §4.1 / §4.2; v2 chain r1–r7).
//
// One dispatch = one work order: identity → durable RESERVE (first per-dispatch filesystem
// effect — §4.2.E reserve-first) → derived resource allocation → typed snapshot + pre-spawn
// topology pass (r7) → attested writer spawn (fresh thread, Q16; sandbox tmp exclusions, Q19)
// → sealed capture → validation (Q9 end-state deltas + both-sides text gate + opaque-root
// baseline semantics) → GITLESS bounded patch generation (Q18) → artifact publication (store
// lock under strict design→store order) → durable completed record. The tool NEVER writes the
// caller repository outside `.codex-review/` and NEVER applies the patch (the driver does,
// after §9 review). Cancellation propagates into lock waits, the SDK turn (TurnOptions.signal),
// and the diff budget; a cancelled dispatch terminalizes `failed (cancelled)` and publishes
// nothing.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";

import type { CodexEffort, ResolvedConfig } from "./config.js";
import { resolveCodexTier, resolveProjectPath } from "./config.js";
import {
  canonicalSetsEqual,
  parseAllowlist,
  parseFilesBlockFromCard,
} from "./allowlist.js";
import {
  ImplementStore,
  PROCESS_EPOCH_STARTED_AT,
  PROCESS_EPOCH_START_TOKEN,
  getDispatch,
  type DispatchRecord,
  type FileChangeFact,
  type PublishedArtifact,
  allocateDispatchResources,
  BlobStore,
  buildSnapshot,
  buildWriterEnvironment,
  computePayloadSha,
  discardDispatchResources,
  ensureFlockSupport,
  generatePatch,
  materializeScratch,
  newArtifactId,
  publishArtifact,
  sealCapture,
  sha256,
  validateCapture,
  validateDispatchKey,
} from "./implement-workspace.js";
import {
  LockCancelledError,
  LockTimeoutError,
  acquisitionDeadline,
} from "./locks.js";

export interface WriterTurnRequest {
  scratchRoot: string;
  prompt: string;
  /** Full replacement env (isolated CODEX_HOME + neutralized git) for the writer CLI. */
  env: Record<string, string>;
  /** CLI `--config` overrides (sandbox tmp exclusions — Q19 defense in depth). */
  cliConfigOverrides?: Record<string, unknown>;
  model?: string;
  effort?: CodexEffort;
  /** Cancellation — MUST be forwarded into the SDK turn (TurnOptions.signal; design §4.4). */
  signal?: AbortSignal;
}

export interface WriterTurnResult {
  text: string;
  /** The (fresh) thread id this turn ran under — recorded per dispatch for audit (Q16). */
  threadId?: string;
  /** Total token estimate for the turn (accounting). */
  tokensTotal?: number;
}

/** Injectable writer boundary: production wraps OpenAICodexClient (tier "implement", fresh
 * thread per dispatch — Q16); tests substitute a scripted writer editing the scratch. */
export type RunWriterTurn = (req: WriterTurnRequest) => Promise<WriterTurnResult>;

export interface ImplementFlowDependencies {
  config: ResolvedConfig;
  configBaseDir: string;
  store: ImplementStore;
  runWriterTurn: RunWriterTurn;
  /** Test seam for the Q19 attestation gate (defaults to the real builder). */
  buildWriterEnv?: typeof buildWriterEnvironment;
}

export interface ImplementFlowInput {
  designId: string;
  taskCardPath: string;
  filesAllowlist: string[];
  workOrder: string;
  dispatchKey: string;
  previousFindings?: unknown;
  /** MCP cancellation signal — propagated into lock waits, the SDK turn, and the diff budget. */
  signal?: AbortSignal;
}

/** Advisory self-report schema (design §4.4 implement_report). */
const SelfReportSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()).optional(),
  tests_run: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export interface ImplementFlowResult {
  ok: boolean;
  replayed?: boolean;
  dispatch_summary?: string;
  patch_path?: string;
  report_path?: string;
  files_changed?: FileChangeFact[];
  diffstat?: { files: number; added: number; removed: number };
  /** Advisory (schema-validated) self report; null with raw_excerpt on parse failure. */
  self_report?: unknown;
  self_report_raw_excerpt?: string;
  violations?: string[];
  error?: string;
  round?: number;
  lifecycle?: string;
  session?: {
    rounds_used: number;
    rounds_max: number;
    codex_failure_streak: number;
    parser_failure_streak: number;
  };
}

/** Built-in prompt fallback; a consumer-seeded `.codex-review/templates/implement.md.tpl`
 * (design §4.4) overrides it when present. */
const BUILTIN_PROMPT = `# ccsop implement dispatch (proposal mode)

You are the IMPLEMENTER for one bounded work order inside an isolated scratch workspace.
The driving session designed this task and will review your diff; you write code, nothing else.

HARD RULES (violations reject the whole dispatch — nothing you did will be kept):
1. Touch ONLY the files listed under FILES below (create/modify/delete exactly there).
2. Do NOT create any other file — no temp files, no build artifacts, no notes.
3. Do NOT run git commit / branch / tag / push. Do not touch .git.
4. Text files only; keep each file under the stated byte limit.
5. When done, output a single JSON object:
   {"summary": "...", "files": ["..."], "tests_run": ["..."], "risks": ["..."], "notes": "..."}

TASK CARD (the contract for this dispatch):
{{task_card}}

WORK ORDER (this dispatch):
{{work_order}}

FILES (the complete allowlist):
{{files}}

PREVIOUS FINDINGS to address (if any):
{{previous_findings}}

Byte limit per file: {{max_file_bytes}}.
Work in the current directory. It is a git checkout; you may read anything, but write only FILES.`;

function renderPrompt(
  config: ResolvedConfig,
  baseDir: string,
  vars: Record<string, string>,
): string {
  let template = BUILTIN_PROMPT;
  try {
    template = readFileSync(
      resolveProjectPath(config, baseDir, ".codex-review/templates/implement.md.tpl"),
      "utf8",
    );
  } catch {
    /* fall back to the built-in prompt */
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Lenient extraction of the last balanced top-level JSON object in the writer text. */
export function extractLastJsonObject(text: string): unknown {
  for (let start = text.lastIndexOf("{"); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
    if (start === 0) break;
  }
  return null;
}

export async function runImplementFlow(
  deps: ImplementFlowDependencies,
  input: ImplementFlowInput,
): Promise<ImplementFlowResult> {
  const { config, configBaseDir, store, runWriterTurn } = deps;

  // ---------- 0) gates + identity (nothing persisted is touched yet) ----------
  if (!config.implement.enabled) {
    return {
      ok: false,
      error:
        "codex_implement is disabled ([implement] enabled=false). Enable it in " +
        ".codex-review/config.toml only for the claude+codex preside flow (collaboration.md §1.D).",
    };
  }
  if (input.designId.endsWith(".implement")) {
    return { ok: false, error: "design_id must not end with '.implement' (reserved namespace suffix)" };
  }
  if (input.signal?.aborted) return { ok: false, error: "dispatch cancelled before start" };
  const keyError = validateDispatchKey(input.dispatchKey);
  if (keyError) return { ok: false, error: keyError };

  const inputList = parseAllowlist(input.filesAllowlist);
  if (!inputList.ok) {
    return { ok: false, error: `files_allowlist invalid:\n${inputList.errors.join("\n")}` };
  }
  const repoRoot = resolveProjectPath(config, configBaseDir, ".");
  let cardText: string;
  try {
    cardText = readFileSync(resolveProjectPath(config, configBaseDir, input.taskCardPath), "utf8");
  } catch (err) {
    return { ok: false, error: `cannot read task card ${input.taskCardPath}: ${(err as Error).message}` };
  }
  const cardSha = sha256(Buffer.from(cardText, "utf8"));
  const cardList = parseFilesBlockFromCard(cardText);
  if (!cardList.ok) {
    return { ok: false, error: `task card \`\`\`files block invalid:\n${cardList.errors.join("\n")}` };
  }
  if (!canonicalSetsEqual(inputList.canonical, cardList.canonical)) {
    return {
      ok: false,
      error:
        "files_allowlist does not equal the task card ```files block (canonical set mismatch). " +
        `input=[${inputList.canonical.join(", ")}] card=[${cardList.canonical.join(", ")}]`,
    };
  }
  const allowlist = inputList.canonical;
  const payloadSha = computePayloadSha({
    workOrder: input.workOrder,
    canonicalAllowlist: allowlist,
    cardSha,
    previousFindings: input.previousFindings,
  });

  // Q17/§4.2.F: control-plane bootstrap + platform capability probe (once per process;
  // idempotent, dispatch-independent — exempt from reserve-first).
  try {
    ensureFlockSupport(repoRoot);
  } catch (err) {
    return { ok: false, error: `control-state unavailable: ${(err as Error).message}` };
  }

  // ---------- 1) per-design transaction lock (kernel flock; ONE acquisition deadline for the
  // entry episode: design lock + recovery's store acquisition — design r7) ----------
  const lockTimeoutMs = config.state.lock_timeout_seconds * 1000;
  const entryDeadline = acquisitionDeadline(lockTimeoutMs);
  let designLock;
  try {
    designLock = await store.lock(input.designId, entryDeadline, input.signal);
  } catch (err) {
    // Control-root violation / flock unavailable / timeout / cancel — nothing was written.
    return { ok: false, error: `control-state unavailable: ${(err as Error).message}` };
  }
  try {
    // ---------- 2) recovery + object-class GC + idempotency lookup (before round allocation) ----------
    let state;
    try {
      state =
        (await store.recoverAndGc(input.designId, entryDeadline, input.signal)) ??
        store.newState(input.designId);
    } catch (err) {
      return { ok: false, error: `control-state unavailable: ${(err as Error).message}` };
    }
    const sessionFacts = () => ({
      rounds_used: state.rounds,
      rounds_max: config.implement.max_implement_rounds,
      codex_failure_streak: state.codex_failure_streak,
      parser_failure_streak: state.parser_failure_streak,
    });
    const existing = getDispatch(state, input.dispatchKey);
    if (existing) {
      if (existing.payload_sha !== payloadSha) {
        return {
          ok: false,
          error: `dispatch_key reuse with a DIFFERENT payload (recorded round ${existing.round}); use a fresh key for a new dispatch`,
          session: sessionFacts(),
        };
      }
      if (existing.lifecycle === "completed") {
        const verified = verifyArtifacts(repoRoot, existing);
        if (!verified.ok) {
          return { ok: false, error: `replay verification failed: ${verified.error}`, session: sessionFacts() };
        }
        return { ...(existing.result as ImplementFlowResult), replayed: true };
      }
      if (existing.lifecycle === "failed") {
        const prior = existing.result as ImplementFlowResult | undefined;
        if (prior) return { ...prior, replayed: true };
        return {
          ok: false,
          error: existing.failure_reason ?? "dispatch failed (no recorded result)",
          round: existing.round,
          lifecycle: "failed",
          replayed: true,
          session: sessionFacts(),
        };
      }
      // reserved/executing with a LIVE epoch while we hold the design lock: same-key concurrent
      // call raced our lock release, or a crashed same-pid predecessor — report in-progress.
      return {
        ok: false,
        error: `dispatch ${input.dispatchKey} is still in progress (lifecycle=${existing.lifecycle})`,
        session: sessionFacts(),
      };
    }

    // ---------- 3) round pre-check + DURABLE RESERVE (first per-dispatch filesystem effect —
    // §4.2.E reserve-first: every resource path is a pure function of the artifact-id and is
    // allocated only after this record is durable) ----------
    if (state.rounds >= config.implement.max_implement_rounds) {
      return {
        ok: false,
        error:
          `max_implement_rounds (${config.implement.max_implement_rounds}) reached for ` +
          `${input.designId} — circuit breaker; escalate to the user per §9.E.`,
        session: sessionFacts(),
      };
    }
    const round = state.rounds + 1;
    const record: DispatchRecord = {
      dispatch_key: input.dispatchKey,
      payload_sha: payloadSha,
      artifact_id: newArtifactId(),
      round,
      lifecycle: "reserved",
      epoch_pid: process.pid,
      epoch_started_at: PROCESS_EPOCH_STARTED_AT,
      ...(PROCESS_EPOCH_START_TOKEN != null ? { epoch_start_token: PROCESS_EPOCH_START_TOKEN } : {}),
    };
    state.dispatches.push(record);
    // The reserved round is consumed durably NOW (breaker honesty across crashes).
    state.rounds = round;
    store.write(state);

    const finishFailed = (result: ImplementFlowResult): ImplementFlowResult => {
      record.lifecycle = "failed";
      record.failure_reason = result.error ?? (result.violations ?? []).join("; ");
      const final = { ...result, round, lifecycle: "failed" as const, session: sessionFacts() };
      record.result = final;
      store.write(state);
      return final;
    };
    const cancelledResult = (stageNote: string): ImplementFlowResult => ({
      ok: false,
      error: `dispatch cancelled ${stageNote}; nothing published`,
    });

    try {
      // ---------- 4) ONE terminalizing envelope for every post-reserve phase ----------
      try {
        const resources = allocateDispatchResources(repoRoot, record.artifact_id);
        const snapshotStore = new BlobStore(resources.snapBlobs);
        const captureStore = new BlobStore(resources.capBlobs);

        // Writer environment + attestation gate (Q11 + Q19): a constructed config missing
        // either tmp exclusion hard-fails BEFORE the writer spawns.
        const { model: writerModel, effort: writerEffort } = resolveCodexTier(
          config,
          "implement",
        );
        const writerEnv = (deps.buildWriterEnv ?? buildWriterEnvironment)(
          resources.home,
          writerModel,
          writerEffort,
        );
        if (!writerEnv.attestation.excludeSlashTmp || !writerEnv.attestation.excludeTmpdirEnvVar) {
          return finishFailed({
            ok: false,
            error:
              "writer sandbox attestation failed: constructed config is missing " +
              "sandbox_workspace_write tmp exclusions (Q19); dispatch refused pre-spawn",
          });
        }

        // Typed snapshot + pre-spawn topology pass (r7): unmerged stages / opaque-root
        // allowlist entries reject BEFORE the writer spawns.
        const snapResult = buildSnapshot(repoRoot, allowlist, snapshotStore);
        if (snapResult.rejections.length > 0) {
          return finishFailed({
            ok: false,
            violations: snapResult.rejections.map((r) => r.reason),
            error: `dispatch rejected pre-spawn (topology): ${snapResult.rejections.length} problem(s)`,
          });
        }
        const snapshot = snapResult.snapshot;
        const scratch = materializeScratch(snapshot, resources.scratch);
        record.lifecycle = "executing";
        store.write(state);

        const prompt = renderPrompt(config, configBaseDir, {
          task_card: cardText,
          work_order: input.workOrder,
          files: allowlist.join("\n"),
          previous_findings: input.previousFindings
            ? JSON.stringify(input.previousFindings, null, 2)
            : "(none)",
          max_file_bytes: String(config.implement.max_file_bytes),
        });

        // ---------- 5) writer turn (FRESH thread per dispatch — Q16; signal forwarded into
        // the SDK turn — TurnOptions.signal) ----------
        let turn: WriterTurnResult;
        try {
          turn = await runWriterTurn({
            scratchRoot: scratch.root,
            prompt,
            env: writerEnv.env,
            cliConfigOverrides: writerEnv.cliConfigOverrides,
            model: writerModel,
            effort: writerEffort,
            signal: input.signal,
          });
          state.codex_failure_streak = 0;
        } catch (err) {
          if (input.signal?.aborted) {
            return finishFailed(cancelledResult("during the writer turn"));
          }
          state.codex_failure_streak += 1;
          const streak = state.codex_failure_streak;
          const threshold = config.circuit_breakers.codex_failure_streak_threshold;
          return finishFailed({
            ok: false,
            error:
              `writer turn failed: ${(err as Error).message}` +
              (streak >= threshold
                ? ` [codex_unavailable breaker: ${streak} consecutive failures]`
                : ""),
          });
        }
        record.thread_id = turn.threadId ?? "";
        state.tokens_used_estimate_total += turn.tokensTotal ?? 0;
        store.write(state);
        if (input.signal?.aborted) {
          return finishFailed(cancelledResult("after the writer turn"));
        }

        // ---------- 6) sealed capture + validation (opaque-root baseline semantics) ----------
        const capture = sealCapture(scratch.root, captureStore, snapshot.opaqueRoots);
        const validation = validateCapture(
          snapshot,
          capture,
          allowlist,
          config.implement.max_file_bytes,
        );
        if (!validation.ok) {
          return finishFailed({
            ok: false,
            violations: validation.violations,
            error: `dispatch rejected: ${validation.violations.length} violation(s); no patch emitted`,
          });
        }
        if (validation.deltas.length === 0) {
          return finishFailed({
            ok: false,
            error: "writer produced no changes (empty delta); no patch emitted",
          });
        }

        // ---------- 7) GITLESS bounded patch (Q18) + scope breaker ----------
        const generated = generatePatch(snapshot, capture, validation.deltas, {
          checkCancel: () => {
            if (input.signal?.aborted) throw new Error("cancelled during patch generation");
          },
        });
        const scopeLimit = config.circuit_breakers.scope_drift_lines_threshold;
        const diffLines = generated.diffstat.added + generated.diffstat.removed;
        if (diffLines > scopeLimit) {
          return finishFailed({
            ok: false,
            error:
              `scope breaker: ${diffLines} changed lines exceed ` +
              `scope_drift_lines_threshold=${scopeLimit}; dispatch discarded`,
          });
        }
        const rawReport = extractLastJsonObject(turn.text);
        const parsedReport = SelfReportSchema.safeParse(rawReport);
        let selfReport: unknown = null;
        let rawExcerpt: string | undefined;
        if (parsedReport.success) {
          selfReport = parsedReport.data;
          state.parser_failure_streak = 0;
        } else {
          state.parser_failure_streak += 1;
          rawExcerpt = turn.text.slice(0, 2000);
        }
        if (input.signal?.aborted) {
          return finishFailed(cancelledResult("before publication"));
        }

        // ---------- 8) publish (fsync, store-locked under design→store order; fresh
        // acquisition deadline for this episode) THEN durable completed ----------
        const report = {
          design_id: input.designId,
          round,
          artifact_id: record.artifact_id,
          files_changed: generated.filesChanged,
          diffstat: generated.diffstat,
          self_report: selfReport,
          writer_attestation: writerEnv.attestation,
          writer_thread_id: record.thread_id,
          generated_at: new Date().toISOString(),
        };
        let published: PublishedArtifact;
        try {
          published = await publishArtifact(
            repoRoot,
            record.artifact_id,
            generated.patch,
            report,
            acquisitionDeadline(lockTimeoutMs),
            input.signal,
          );
        } catch (err) {
          if (err instanceof LockTimeoutError) {
            return finishFailed({
              ok: false,
              error: `artifact publication failed (lock timeout): ${(err as Error).message}`,
            });
          }
          if (err instanceof LockCancelledError || input.signal?.aborted) {
            return finishFailed(cancelledResult("during publication"));
          }
          return finishFailed({
            ok: false,
            error: `artifact publication failed: ${(err as Error).message}`,
          });
        }
        const result: ImplementFlowResult = {
          ok: true,
          dispatch_summary:
            `round ${round}: ${generated.diffstat.files} file(s), +${generated.diffstat.added}/-${generated.diffstat.removed}; ` +
            `patch ready for driver review + git apply`,
          patch_path: relative(repoRoot, published.patchPath),
          report_path: relative(repoRoot, published.reportPath),
          files_changed: generated.filesChanged,
          diffstat: generated.diffstat,
          self_report: selfReport,
          ...(rawExcerpt !== undefined ? { self_report_raw_excerpt: rawExcerpt } : {}),
          violations: [],
          round,
          lifecycle: "completed",
          session: sessionFacts(),
        };
        record.lifecycle = "completed";
        record.result = result;
        record.patch_sha = published.patchSha;
        record.patch_size = published.patchSize;
        record.report_sha = published.reportSha;
        record.report_size = published.reportSize;
        store.write(state);
        return result;
      } catch (err) {
        // Terminalizing catch: NO post-reserve exception may strand a live nonterminal record.
        if (input.signal?.aborted) {
          return finishFailed(cancelledResult(`(${(err as Error).message})`));
        }
        return finishFailed({
          ok: false,
          error: `dispatch phase failed: ${(err as Error).message}`,
        });
      }
    } finally {
      // Derived working residue is discarded unconditionally (published artifacts persist).
      try {
        discardDispatchResources(repoRoot, record.artifact_id);
      } catch {
        /* residue GC will reap it on the next call */
      }
    }
  } finally {
    designLock.release();
  }
}

function verifyArtifacts(
  repoRoot: string,
  record: DispatchRecord,
): { ok: true } | { ok: false; error: string } {
  try {
    const result = record.result as ImplementFlowResult;
    for (const [rel, sha, size] of [
      [result.patch_path, record.patch_sha, record.patch_size],
      [result.report_path, record.report_sha, record.report_size],
    ] as const) {
      if (!rel || !sha) return { ok: false, error: "completed record missing artifact facts" };
      const bytes = readFileSync(`${repoRoot}/${rel}`);
      if (bytes.length !== size || sha256(bytes) !== sha) {
        return { ok: false, error: `artifact ${rel} does not match recorded hash/size` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
