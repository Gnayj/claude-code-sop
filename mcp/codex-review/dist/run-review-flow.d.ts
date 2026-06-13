import type { ResolvedConfig } from "./config.js";
import { BreakerEngine, type BreakerState, type BreakerTriggered } from "./circuit-breakers.js";
import { type ParseResult } from "./output-parser.js";
import { PromptRenderer, type PromptVars } from "./prompt-renderer.js";
import type { ReviewProvider } from "./review-provider.js";
import { ThreadManager } from "./thread-manager.js";
import type { ReviewEnvelope, ReviewStage } from "./types.js";
export interface FlowDependencies {
    config: ResolvedConfig;
    configBaseDir: string;
    /** Review backend behind the raw-turn boundary (design §4.7). Selected by the factory
     * from config.review.provider. Replaces the previous direct `codex: CodexClient`. */
    provider: ReviewProvider;
    threadManager: ThreadManager;
    promptRenderer: PromptRenderer;
    breakers: BreakerEngine;
    /** External breaker state accumulated across calls within the same orchestrator. */
    breakerState: BreakerState;
}
export interface FlowInput {
    stage: ReviewStage;
    designId: string;
    /** Files to inject and run drift detection over. */
    designDocPaths: string[];
    /** Other context files to attach without drift tracking. */
    fileBlocks: Array<{
        label: string;
        path: string;
    }>;
    /** Variables substituted into the template body. */
    promptVars: PromptVars;
    /** Whether the caller already supplied previous_round_resolved (only relevant for stage='fix'). */
    hasPreviousRoundResolved: boolean;
    /** Caller may force opening a fresh thread (e.g. design_id reset). */
    forceNewThread: boolean;
    /**
     * For fix stage: lines added in this round's fix attempt. The flow accumulates this into
     * state.scope_drift_lines_total and trips the scope_drift breaker if the threshold is crossed.
     * Other stages (design / code) should pass undefined (caller's responsibility).
     */
    fixDiffLines?: number;
    /** Manual provider two-phase submit: path to a human-pasted verdict.json (design §4.7 C2).
     * When set, ManualProvider ingests it as a turn instead of preparing a new prompt. */
    manualVerdictPath?: string;
}
export interface FlowResult {
    ok: boolean;
    envelope?: ReviewEnvelope;
    /** Present for every real review turn. Omitted on the manual `awaitingManual` control branch
     * (no parse ran) — see design §4.7 C2. */
    parseResult?: ParseResult;
    /** Breaker triggered — caller should stop and report to user. */
    breakerTripped?: BreakerTriggered;
    /** Warnings to surface to the user. */
    warnings: string[];
    /** True if this call rebuilt the thread because previous round saturated context. */
    didRebuildThread?: boolean;
    /** Manual two-phase prepare (design §4.7 C2): provider wrote a prompt for a human/external
     * reviewer and is awaiting a verdict. NO parse / breaker / usage / round write happened;
     * the submit call re-enters with the verdict. codex / claude never set this. */
    awaitingManual?: {
        prompt_path: string;
        verdict_path_expected: string;
    };
}
export declare function runReviewFlow(deps: FlowDependencies, input: FlowInput): Promise<FlowResult>;
//# sourceMappingURL=run-review-flow.d.ts.map