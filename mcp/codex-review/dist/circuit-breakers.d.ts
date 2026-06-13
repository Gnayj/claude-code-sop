import type { ResolvedConfig } from "./config.js";
import type { ReviewStage } from "./types.js";
export type BreakerName = "max_review_rounds" | "scope_drift" | "context_exhausted" | "codex_unavailable" | "parser_unavailable";
export interface BreakerState {
    rounds: {
        design_review: number;
        code_review: number;
        fix_review: number;
    };
    /** Cumulative implementation/fix lines since stage 6 of the auto-loop. */
    scope_drift_lines: number;
    /** Streaks for boolean event types. */
    codex_failure_streak: number;
    parser_failure_streak: number;
    context_exhausted_triggered: boolean;
}
export declare function initialBreakerState(): BreakerState;
export interface BreakerTriggered {
    name: BreakerName;
    message: string;
}
export declare class BreakerEngine {
    private readonly config;
    constructor(config: ResolvedConfig);
    /** Throws on threshold relaxation; called once at construction. */
    private assertThresholdsShrinkOnly;
    bumpRound(state: BreakerState, stage: ReviewStage): BreakerTriggered | null;
    recordScopeDrift(state: BreakerState, addedLines: number): BreakerTriggered | null;
    recordCodexFailure(state: BreakerState): BreakerTriggered | null;
    recordCodexSuccess(state: BreakerState): void;
    recordParserFailure(state: BreakerState): BreakerTriggered | null;
    recordParserSuccess(state: BreakerState): void;
    triggerContextExhausted(state: BreakerState): BreakerTriggered;
}
//# sourceMappingURL=circuit-breakers.d.ts.map