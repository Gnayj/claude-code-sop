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
import { IMPLEMENT_MIN_POLICY, MIN_SAFETY_POLICY } from "./safety.js";
import type { CodexEffort } from "./config.js";
import {
  resolveCodexBinary,
  formatProvenance,
  NoCodexBinaryError,
  type CodexResolution,
} from "./codex-resolve.js";

export interface ThreadHandle {
  threadId: string;
  /** Send one user-turn input; receive Codex assistant text + usage estimate. The optional
   * signal is forwarded into the SDK turn (TurnOptions.signal — design §4.4 cancellation). */
  runTurn(input: string, signal?: AbortSignal): Promise<RunTurnResult>;
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
  /** Optional reasoning effort; undefined = SDK default. */
  effort?: CodexEffort;
  /**
   * Safety tier for the thread (design ccsop-codex-implement §4.3). Default "review" keeps the
   * byte-pinned read-only MIN_SAFETY_POLICY. "implement" applies IMPLEMENT_MIN_POLICY:
   * workspace-write scoped to `workingDirectory` (the scratch), approval=never, no network,
   * no web search. Mock clients may ignore this field.
   */
  tier?: "review" | "implement";
}

export interface CodexClient {
  startThread(opts: StartThreadOptions): Promise<ThreadHandle>;
  resumeThread(threadId: string, opts?: StartThreadOptions): Promise<ThreadHandle>;
  /** Health check — used by the `codex_unavailable` breaker. */
  ping(): Promise<void>;
  /** Resolved codex-binary provenance once a thread has been opened; null before, or for clients
   * that don't resolve a binary (mocks). Surfaced into the review result so a PATH-resolved
   * substitution is user-visible, not just in server logs (design Q1.b). */
  getProvenance?(): CodexResolution | null;
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
export function forcedThreadOptions(tier: "review" | "implement" = "review"): Pick<
  ThreadOptions,
  | "sandboxMode"
  | "approvalPolicy"
  | "networkAccessEnabled"
  | "webSearchEnabled"
  | "webSearchMode"
> {
  if (tier === "implement") {
    return {
      sandboxMode: IMPLEMENT_MIN_POLICY.sandboxMode, // workspace-write (scratch-scoped)
      approvalPolicy: IMPLEMENT_MIN_POLICY.approvalPolicy,
      networkAccessEnabled: IMPLEMENT_MIN_POLICY.network, // false
      webSearchEnabled: IMPLEMENT_MIN_POLICY.webSearch, // false
      webSearchMode: "disabled",
    };
  }
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
// Codex-binary resolution is deterministic per process (config path + PATH are static), so resolve
// and probe ONCE and share across every client. This matters for the implement path, which builds a
// fresh OpenAICodexClient per dispatch (design Q16) — without this cache each dispatch would re-run
// the blocking `--version` smoke probe. Keyed by config path (the only per-client input to the chain).
const resolutionCache = new Map<string, CodexResolution>();

function resolveCodexOnce(configPath: string | undefined): CodexResolution {
  const key = configPath ?? "";
  const cached = resolutionCache.get(key);
  if (cached) return cached;
  const resolution = resolveCodexBinary({ configPath });
  resolutionCache.set(key, resolution);
  // Provenance is observable (design Q1.b): log which binary won — once per distinct config path.
  process.stderr.write(`[codex-review-mcp] ${formatProvenance(resolution)}\n`);
  return resolution;
}

/**
 * Map a `new Codex()` construction failure to the right error class (design bridge-deps §4.1 Q3).
 * When the PACKAGE link won but its native binary is missing/unusable, the SDK throws "Unable to
 * locate Codex CLI binaries" — that is the same user problem as link-4 exhaustion, so surface the
 * legible three-remedy NoCodexBinaryError rather than the bare SDK message. Any other construction
 * failure (genuine capability gap) stays a CodexCapabilityMissingError.
 */
export function classifyCodexConstructionError(
  source: CodexResolution["source"],
  err: Error,
): Error {
  if (source === "package" && /locate Codex CLI binaries|optional dependencies/i.test(err.message)) {
    return new NoCodexBinaryError();
  }
  return new CodexCapabilityMissingError([
    `cannot construct Codex from @openai/codex-sdk: ${err.message}`,
  ]);
}

export class OpenAICodexClient implements CodexClient {
  private agent: Codex | null = null;
  private resolution: CodexResolution | null = null;

  constructor(
    private readonly options: {
      defaultModel?: string;
      defaultEffort?: CodexEffort;
      /** Full replacement env for the spawned CLI (design §4.2.C writer isolation: pass the
       * dedicated minimal CODEX_HOME env; the SDK then does NOT inherit process.env). */
      env?: Record<string, string>;
      /** CLI `--config key=value` overrides (design Q19: sandbox tmp exclusions — defense in
       * depth on top of the server-authored CODEX_HOME config.toml). */
      config?: Record<string, unknown>;
      /** Explicit codex binary path (config `[codex] path`, chain link 1). "" / undefined =
       * fall through to the package → PATH → legible-error chain. (design bridge-deps-lifecycle §4.1) */
      codexPath?: string;
    } = {},
  ) {}

  /** Resolved codex-binary provenance, available after the first getAgent(); null before.
   * Surfaced into the review result (design Q1.b) so a PATH-resolved binary is user-visible. */
  getProvenance(): CodexResolution | null {
    return this.resolution;
  }

  private getAgent(): Codex {
    if (this.agent !== null) return this.agent;
    // Resolve the codex binary first (config → package → PATH → NoCodexBinaryError), memoized per
    // process. Only the package link (undefined override) defers resolution to the SDK; links 1/3
    // pin the path.
    const resolution = resolveCodexOnce(this.options.codexPath);
    this.resolution = resolution;
    try {
      this.agent = new Codex({
        ...(resolution.codexPathOverride
          ? { codexPathOverride: resolution.codexPathOverride }
          : {}),
        ...(this.options.env ? { env: this.options.env } : {}),
        ...(this.options.config ? { config: this.options.config as never } : {}),
      });
    } catch (err) {
      // Package-link native-binary failure → legible three-remedy error (design Q3); else capability.
      throw classifyCodexConstructionError(resolution.source, err as Error);
    }
    return this.agent;
  }

  async startThread(opts: StartThreadOptions): Promise<ThreadHandle> {
    const agent = this.getAgent();
    const model = opts.model || this.options.defaultModel;
    const effort = opts.effort || this.options.defaultEffort;
    const thread = agent.startThread({
      workingDirectory: opts.workingDirectory,
      ...(model ? { model } : {}),
      ...(effort ? { modelReasoningEffort: effort } : {}),
      ...forcedThreadOptions(opts.tier ?? "review"),
    });
    // For a fresh thread, SDK populates Thread.id only after the first run.
    // Wrap with no fallback; caller must call runTurn before reading threadId.
    return wrapThread(thread, null);
  }

  async resumeThread(threadId: string, opts?: StartThreadOptions): Promise<ThreadHandle> {
    const agent = this.getAgent();
    const model = opts?.model || this.options.defaultModel;
    const effort = opts?.effort || this.options.defaultEffort;
    const thread = agent.resumeThread(threadId, {
      ...(opts?.workingDirectory ? { workingDirectory: opts.workingDirectory } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { modelReasoningEffort: effort } : {}),
      ...forcedThreadOptions(opts?.tier ?? "review"),
    });
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
    async runTurn(input: string, signal?: AbortSignal): Promise<RunTurnResult> {
      const turn = await thread.run(input, signal ? { signal } : undefined);
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
