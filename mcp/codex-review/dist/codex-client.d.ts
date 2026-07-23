import { type ThreadOptions } from "@openai/codex-sdk";
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
}
export declare class CodexCapabilityMissingError extends Error {
    constructor(missing: readonly string[]);
}
/**
 * Thread options forced on every startThread/resumeThread invocation.
 * Maps our internal MIN_SAFETY_POLICY (which uses canonical short names like `network`)
 * to the actual SDK ThreadOptions field names.
 */
export declare function forcedThreadOptions(tier?: "review" | "implement"): Pick<ThreadOptions, "sandboxMode" | "approvalPolicy" | "networkAccessEnabled" | "webSearchEnabled" | "webSearchMode">;
/**
 * Concrete CodexClient backed by `@openai/codex-sdk`.
 *
 * The Codex constructor is lazily invoked on first use so tests can avoid
 * touching the real SDK by providing their own CodexClient implementation.
 */
export declare class OpenAICodexClient implements CodexClient {
    private readonly options;
    private agent;
    constructor(options?: {
        defaultModel?: string;
        /** Full replacement env for the spawned CLI (design §4.2.C writer isolation: pass the
         * dedicated minimal CODEX_HOME env; the SDK then does NOT inherit process.env). */
        env?: Record<string, string>;
        /** CLI `--config key=value` overrides (design Q19: sandbox tmp exclusions — defense in
         * depth on top of the server-authored CODEX_HOME config.toml). */
        config?: Record<string, unknown>;
    });
    private getAgent;
    startThread(opts: StartThreadOptions): Promise<ThreadHandle>;
    resumeThread(threadId: string, opts?: StartThreadOptions): Promise<ThreadHandle>;
    ping(): Promise<void>;
}
//# sourceMappingURL=codex-client.d.ts.map