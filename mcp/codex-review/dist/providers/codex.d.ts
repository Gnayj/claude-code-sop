import type { CodexClient } from "../codex-client.js";
import type { ProviderSession, ProviderRunResult, RenderedReviewPrompt, ReviewProvider, PersistedProviderSession } from "../review-provider.js";
import type { ReviewStage } from "../types.js";
export interface CodexProviderOptions {
    /** Repo root the codex agent operates within (read-only). Constant per server. */
    workingDirectory: string;
    /** Optional model id; "" / undefined = SDK default. */
    model?: string;
}
export declare class CodexProvider implements ReviewProvider {
    private readonly codex;
    private readonly opts;
    readonly kind: "codex";
    constructor(codex: CodexClient, opts: CodexProviderOptions);
    openSession(stage: ReviewStage, designId: string, prior?: PersistedProviderSession): Promise<ProviderSession>;
    runTurn(input: RenderedReviewPrompt, session: ProviderSession): Promise<ProviderRunResult>;
    closeSession(_session: ProviderSession): void;
}
//# sourceMappingURL=codex.d.ts.map