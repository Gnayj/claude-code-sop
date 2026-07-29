// ClaudeProvider — review via the Anthropic SDK or Claude CLI (design §4.7).
//
// Heterogeneity caveat (Q5, written honestly in config/README): a claude review LOSES the
// cross-model signal that codex provides (codex has caught real bugs claude missed). To
// partially compensate, ClaudeProvider runs a FRESH instance per turn with a strong
// ADVERSARIAL reviewer system prompt — it does not converse with itself across rounds
// (cross-round continuity is already injected into the prompt by the orchestrator via
// previous_round_* + cold-start preface). It therefore reports a single-turn
// context_usage_pct estimate (input_tokens / context_window), surfaced to the orchestrator
// which is authoritative for context_usage_pct.

import type { ClaudeClient, ClaudeRunResult } from "../claude-client.js";
import {
  ClaudeCliQuotaError,
  ClaudeCliResumeInvalidError,
  type ClaudeCliClient,
  type ClaudeCliRunResult,
} from "../claude-cli-client.js";
import type { ClaudeEffort } from "../config.js";
import type {
  PersistedProviderSession,
  ProviderRunResult,
  ProviderSessionRotation,
  ProviderSession,
  RenderedReviewPrompt,
  ReviewProvider,
} from "../review-provider.js";
import type { ReviewStage } from "../types.js";

/**
 * Adversarial reviewer framing. Because claude lacks the cross-model heterogeneity of codex,
 * it is pushed to be maximally skeptical and to never rubber-stamp.
 */
export const CLAUDE_ADVERSARIAL_SYSTEM = [
  "You are an INDEPENDENT, ADVERSARIAL reviewer for a software delivery SOP.",
  "You did NOT write the code or the design under review. Assume it contains bugs, gaps, and",
  "scope drift until proven otherwise. Do NOT rubber-stamp. Actively hunt for: spec deviations,",
  "missing tests/artifacts, broken invariants, unsafe edits, and stale handoff/doc state.",
  "You are the only review signal here, so be stricter than a peer reviewer would be.",
  "Follow the review order and rules given in the user message exactly, and output ONLY the",
  "single required envelope JSON object — no prose, no markdown fences.",
].join(" ");

export interface ClaudeProviderOptions {
  backend?: "api" | "cli";
  model: string;
  maxTokens: number;
  contextWindow: number;
  effort?: ClaudeEffort | "";
  cliClient?: ClaudeCliRunner;
  keyEnv?: string;
}

export type ClaudeCliRunner = Pick<ClaudeCliClient, "resolution" | "runTurn">;

interface ClaudeSessionHandle {
  invalidatedSessionId?: string;
  invalidatedReason?: string;
}

export class ClaudeProvider implements ReviewProvider {
  readonly kind = "claude" as const;
  readonly can_read_repo = false;

  constructor(
    private readonly client: ClaudeClient,
    private readonly opts: ClaudeProviderOptions,
  ) {}

  async openSession(
    stage: ReviewStage,
    designId: string,
    prior?: PersistedProviderSession,
  ): Promise<ProviderSession> {
    if (this.opts.backend === "cli") {
      const candidate =
        prior?.provider_kind === "claude" ? prior.external_session_id : "";
      const synthetic = candidate.startsWith("claude:");
      return {
        kind: "claude",
        designId,
        stage,
        externalSessionId: synthetic ? "" : candidate,
        ...(synthetic
          ? {
              handle: {
                invalidatedSessionId: candidate,
                invalidatedReason: "the session was created by the API backend",
              } satisfies ClaudeSessionHandle,
            }
          : {}),
      };
    }
    return {
      kind: "claude",
      designId,
      stage,
      externalSessionId: `claude:${designId}:${stage}`,
    };
  }

  async runTurn(
    input: RenderedReviewPrompt,
    session: ProviderSession,
  ): Promise<ProviderRunResult> {
    if (this.opts.backend !== "cli") {
      return this.apiTurn(input, session.externalSessionId);
    }
    const cli = this.opts.cliClient;
    if (!cli) throw new Error("Claude CLI backend was constructed without a CLI client");
    const handle = (session.handle ?? {}) as ClaudeSessionHandle;
    const warnings: string[] = [];
    let sessionRotation: ProviderSessionRotation | undefined;
    if (handle.invalidatedSessionId) {
      warnings.push(this.resumeWarning(
        handle.invalidatedSessionId,
        handle.invalidatedReason ?? "the session cannot be resumed",
      ));
      sessionRotation = {
        previous_session_id: handle.invalidatedSessionId,
        reason: "provider_resume_invalidated",
      };
    }
    let result: ClaudeCliRunResult;
    try {
      result = await cli.runTurn(this.cliInput(input, session.externalSessionId));
    } catch (error) {
      if (error instanceof ClaudeCliResumeInvalidError && session.externalSessionId) {
        warnings.push(this.resumeWarning(session.externalSessionId, error.message));
        sessionRotation = {
          previous_session_id: session.externalSessionId,
          reason: "provider_resume_invalidated",
        };
        result = await cli.runTurn(this.cliInput(input, ""));
      } else if (
        error instanceof ClaudeCliQuotaError &&
        this.opts.keyEnv &&
        Boolean(process.env[this.opts.keyEnv])
      ) {
        const fallback = await this.apiTurn(
          input,
          `claude:${session.designId}:${session.stage}`,
        );
        const quotaWarning =
          `Claude reviewer backend=cli hit quota (${error.message}); ` +
          `previous_session_id=${session.externalSessionId || "(none)"}; ` +
          `fell back to backend=api for this turn; next CLI turn starts fresh; ` +
          `model=${this.opts.model}`;
        // Keep any warnings already accumulated this turn (e.g. an API-backend session handed to
        // the CLI backend at openSession). Dropping them would hide one degradation behind
        // another, which §4.5 forbids: every fallback must stay visible.
        return {
          ...fallback,
          warnings: [...warnings, quotaWarning],
          session_rotation: {
            previous_session_id: session.externalSessionId,
            reason: "provider_backend_fallback",
          },
        };
      } else {
        throw error;
      }
    }
    warnings.push(...result.warnings);
    return this.cliResult(result, warnings, sessionRotation);
  }

  reviewerProvenance(): string {
    if (this.opts.backend !== "cli") {
      return `Claude reviewer backend=api model=${this.opts.model}`;
    }
    const resolution = this.opts.cliClient?.resolution;
    return `Claude reviewer backend=cli binary_source=${resolution?.source ?? "unknown"} ` +
      `binary=${resolution?.binaryPath ?? "unknown"} model=${this.opts.model}`;
  }

  private async apiTurn(
    input: RenderedReviewPrompt,
    providerSessionId: string,
  ): Promise<Extract<ProviderRunResult, { kind: "turn" }>> {
    const result = await this.client.runTurn({
      system: CLAUDE_ADVERSARIAL_SYSTEM,
      model: this.opts.model,
      maxTokens: this.opts.maxTokens,
      ...(this.opts.effort ? { effort: this.opts.effort } : {}),
      userPrompt: input.text,
    });
    return this.turnResult(result, providerSessionId, this.opts.contextWindow);
  }

  private cliInput(input: RenderedReviewPrompt, resumeSessionId: string) {
    return {
      system: CLAUDE_ADVERSARIAL_SYSTEM,
      model: this.opts.model,
      ...(this.opts.effort ? { effort: this.opts.effort } : {}),
      userPrompt: input.text,
      workingDirectory: input.workingDirectory,
      ...(resumeSessionId ? { resumeSessionId } : {}),
    };
  }

  private cliResult(
    result: ClaudeCliRunResult,
    warnings: string[],
    sessionRotation?: ProviderSessionRotation,
  ): Extract<ProviderRunResult, { kind: "turn" }> {
    return this.turnResult(
      result,
      result.sessionId,
      result.contextWindow ?? this.opts.contextWindow,
      warnings,
      sessionRotation,
    );
  }

  private turnResult(
    result: ClaudeRunResult | ClaudeCliRunResult,
    providerSessionId: string,
    contextWindow: number,
    warnings?: string[],
    sessionRotation?: ProviderSessionRotation,
  ): Extract<ProviderRunResult, { kind: "turn" }> {
    const inputTokens = result.usage.inputTokens;
    const contextUsagePct =
      inputTokens !== null && contextWindow > 0
        ? Math.min(1, inputTokens / contextWindow)
        : undefined;
    return {
      kind: "turn",
      text: result.text,
      usage: {
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
        total:
          (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) || null,
        context_usage_pct: contextUsagePct,
      },
      provider_session_id: providerSessionId,
      ...(warnings?.length ? { warnings } : {}),
      ...(sessionRotation ? { session_rotation: sessionRotation } : {}),
    };
  }

  private resumeWarning(sessionId: string, reason: string): string {
    return `Claude CLI resume invalidated: old_session_id=${sessionId}; reason=${reason}; ` +
      "started a fresh CLI session";
  }

  closeSession(_session: ProviderSession): void {
    // Clients hold no per-session resources.
  }
}
