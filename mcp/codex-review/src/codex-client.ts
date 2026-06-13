// Codex SDK wrapper.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §6.1.1 + §6.3 + §15.7 M1
//
// SDK actual API (verified against `@openai/codex-sdk@0.128.0` typings 2026-05-05):
//   - Codex class: `startThread(opts?)` and `resumeThread(id, opts?)` are SYNC, return Thread.
//   - Thread.run(input) returns { items, finalResponse, usage }.
//   - ThreadOptions actual names (verified):
//       sandboxMode: "read-only" | "workspace-write" | "danger-full-access"
//       approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted"
//       networkAccessEnabled: boolean   (NOT `network`)
//       webSearchEnabled: boolean       (NOT `webSearch`)
//       webSearchMode: "disabled" | "cached" | "live"
//       workingDirectory: string
//   - Usage: { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
//     (no totalTokens — server computes sum).
//
// Per task card §5 hard-constraint 5: SDK names already verified against package typings;
// any future SDK API change is fix-in-place here.

import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";
import { MIN_SAFETY_POLICY } from "./safety.js";

export interface ThreadHandle {
  threadId: string;
  /** Send one user-turn input; receive Codex assistant text + usage estimate. */
  runTurn(input: string): Promise<RunTurnResult>;
}

export interface RunTurnResult {
  text: string;
  /** Token counts when SDK exposes them; otherwise null. */
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
}

export interface StartThreadOptions {
  /** Working directory the Codex agent operates within. */
  workingDirectory: string;
  /** Optional model id; "" = SDK default. */
  model?: string;
}

export interface CodexClient {
  startThread(opts: StartThreadOptions): Promise<ThreadHandle>;
  resumeThread(threadId: string): Promise<ThreadHandle>;
  /** Health check — used by the `codex_unavailable` breaker. */
  ping(): Promise<void>;
}

export class CodexCapabilityMissingError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Codex SDK is missing required capabilities: ${missing.join(", ")}. ` +
        `Server cannot run because MIN_SAFETY_POLICY (sandboxMode/approvalPolicy/network/webSearch) ` +
        `must be enforceable. Please upgrade @openai/codex-sdk.`,
    );
    this.name = "CodexCapabilityMissingError";
  }
}

/**
 * Thread options forced on every startThread/resumeThread invocation.
 * Maps our internal MIN_SAFETY_POLICY (which uses canonical short names like `network`)
 * to the actual SDK ThreadOptions field names.
 */
export function forcedThreadOptions(): Pick<
  ThreadOptions,
  | "sandboxMode"
  | "approvalPolicy"
  | "networkAccessEnabled"
  | "webSearchEnabled"
  | "webSearchMode"
> {
  return {
    sandboxMode: MIN_SAFETY_POLICY.sandboxMode,
    approvalPolicy: MIN_SAFETY_POLICY.approvalPolicy,
    networkAccessEnabled: MIN_SAFETY_POLICY.network, // false
    webSearchEnabled: MIN_SAFETY_POLICY.webSearch, // false
    webSearchMode: "disabled",
  };
}

/**
 * Concrete CodexClient backed by `@openai/codex-sdk`.
 *
 * The Codex constructor is lazily invoked on first use so tests can avoid
 * touching the real SDK by providing their own CodexClient implementation.
 */
export class OpenAICodexClient implements CodexClient {
  private agent: Codex | null = null;

  constructor(
    private readonly options: { defaultModel?: string } = {},
  ) {}

  private getAgent(): Codex {
    if (this.agent !== null) return this.agent;
    try {
      this.agent = new Codex({});
    } catch (err) {
      throw new CodexCapabilityMissingError([
        `cannot construct Codex from @openai/codex-sdk: ${(err as Error).message}`,
      ]);
    }
    return this.agent;
  }

  async startThread(opts: StartThreadOptions): Promise<ThreadHandle> {
    const agent = this.getAgent();
    const thread = agent.startThread({
      workingDirectory: opts.workingDirectory,
      ...(opts.model || this.options.defaultModel
        ? { model: opts.model || this.options.defaultModel }
        : {}),
      ...forcedThreadOptions(),
    });
    // For a fresh thread, SDK populates Thread.id only after the first run.
    // Wrap with no fallback; caller must call runTurn before reading threadId.
    return wrapThread(thread, null);
  }

  async resumeThread(threadId: string): Promise<ThreadHandle> {
    const agent = this.getAgent();
    const thread = agent.resumeThread(threadId, forcedThreadOptions());
    // Resume case: caller already knows the id; surface it immediately.
    return wrapThread(thread, threadId);
  }

  async ping(): Promise<void> {
    // Lazy-construct only; if it throws here, caller treats as `codex_unavailable`.
    this.getAgent();
  }
}

function wrapThread(thread: Thread, fallbackId: string | null): ThreadHandle {
  return {
    // SDK Thread.id is null until first run starts. For resumed threads we have
    // the id from caller (fallbackId). For new threads it stays empty until
    // runTurn populates Thread.id; access before that returns "".
    get threadId(): string {
      return thread.id ?? fallbackId ?? "";
    },
    async runTurn(input: string): Promise<RunTurnResult> {
      const turn = await thread.run(input);
      const text = turn.finalResponse;
      if (!text) {
        throw new CodexCapabilityMissingError([
          "thread.run returned empty finalResponse",
        ]);
      }
      const u = turn.usage;
      const usage = u
        ? {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            totalTokens:
              (u.input_tokens ?? 0) +
              (u.cached_input_tokens ?? 0) +
              (u.output_tokens ?? 0) +
              (u.reasoning_output_tokens ?? 0),
          }
        : null;
      return { text, usage };
    },
  };
}
