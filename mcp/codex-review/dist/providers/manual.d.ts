import type { PersistedProviderSession, ProviderRunResult, ProviderSession, RenderedReviewPrompt, ReviewProvider } from "../review-provider.js";
import type { ReviewStage } from "../types.js";
export interface ManualProviderOptions {
    /** Directory for <design_id>.<stage>.r<round>.{prompt.md,verdict.json}. */
    sessionsDir: string;
}
export declare class ManualProvider implements ReviewProvider {
    private readonly opts;
    readonly kind: "manual";
    constructor(opts: ManualProviderOptions);
    openSession(stage: ReviewStage, designId: string, _prior?: PersistedProviderSession): Promise<ProviderSession>;
    runTurn(input: RenderedReviewPrompt, session: ProviderSession): Promise<ProviderRunResult>;
    closeSession(_session: ProviderSession): void;
}
//# sourceMappingURL=manual.d.ts.map