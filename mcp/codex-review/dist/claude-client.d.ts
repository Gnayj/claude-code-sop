export interface ClaudeRunInput {
    system: string;
    model: string;
    maxTokens: number;
    /** Single review prompt sent as one user message (the claude provider is per-turn fresh). */
    userPrompt: string;
}
export interface ClaudeRunResult {
    text: string;
    usage: {
        inputTokens: number | null;
        outputTokens: number | null;
    };
}
export interface ClaudeClient {
    runTurn(input: ClaudeRunInput): Promise<ClaudeRunResult>;
}
export declare class ClaudeKeyMissingError extends Error {
    constructor(keyEnv: string);
}
/** Concrete ClaudeClient backed by @anthropic-ai/sdk. Lazy-constructs the SDK on first use. */
export declare class AnthropicClaudeClient implements ClaudeClient {
    private readonly opts;
    private client;
    constructor(opts: {
        keyEnv: string;
    });
    private getClient;
    runTurn(input: ClaudeRunInput): Promise<ClaudeRunResult>;
}
//# sourceMappingURL=claude-client.d.ts.map