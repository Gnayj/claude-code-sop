import { type ThreadOptions } from "@openai/codex-sdk";
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
export declare class CodexCapabilityMissingError extends Error {
    constructor(missing: readonly string[]);
}
/**
 * Thread options forced on every startThread/resumeThread invocation.
 * Maps our internal MIN_SAFETY_POLICY (which uses canonical short names like `network`)
 * to the actual SDK ThreadOptions field names.
 */
export declare function forcedThreadOptions(): Pick<ThreadOptions, "sandboxMode" | "approvalPolicy" | "networkAccessEnabled" | "webSearchEnabled" | "webSearchMode">;
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
    });
    private getAgent;
    startThread(opts: StartThreadOptions): Promise<ThreadHandle>;
    resumeThread(threadId: string): Promise<ThreadHandle>;
    ping(): Promise<void>;
}
//# sourceMappingURL=codex-client.d.ts.map