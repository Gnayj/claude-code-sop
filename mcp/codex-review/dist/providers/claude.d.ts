import type { ClaudeClient } from "../claude-client.js";
import type { PersistedProviderSession, ProviderRunResult, ProviderSession, RenderedReviewPrompt, ReviewProvider } from "../review-provider.js";
import type { ReviewStage } from "../types.js";
/**
 * Adversarial reviewer framing. Because claude lacks the cross-model heterogeneity of codex,
 * it is pushed to be maximally skeptical and to never rubber-stamp.
 */
export declare const CLAUDE_ADVERSARIAL_SYSTEM: string;
export interface ClaudeProviderOptions {
    model: string;
    maxTokens: number;
    contextWindow: number;
}
export declare class ClaudeProvider implements ReviewProvider {
    private readonly client;
    private readonly opts;
    readonly kind: "claude";
    constructor(client: ClaudeClient, opts: ClaudeProviderOptions);
    openSession(stage: ReviewStage, designId: string, _prior?: PersistedProviderSession): Promise<ProviderSession>;
    runTurn(input: RenderedReviewPrompt, session: ProviderSession): Promise<ProviderRunResult>;
    closeSession(_session: ProviderSession): void;
}
//# sourceMappingURL=claude.d.ts.map