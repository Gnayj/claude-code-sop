import type { ResolvedConfig } from "./config.js";
import { AnyVerdict, ReviewEnvelope, type ReviewStage, type VerdictFactors } from "./types.js";
export interface ParseSuccess {
    ok: true;
    envelope: ReviewEnvelope;
    warnings: string[];
    /** True if parser forced verdict more conservative than what Codex returned. */
    forced_upgrade: boolean;
    /** True if any verdict_factor was missing/invalid -> downgraded. */
    downgraded_for_missing_factors: boolean;
}
export interface ParseFailure {
    ok: false;
    reason: "schema_violation" | "old_verdict_rejected" | "stage_verdict_mismatch" | "fix_missing_previous_round_resolved" | "non_json";
    detail: string;
    /** Raw payload Codex returned, for logging / retry. */
    raw_excerpt: string;
}
export type ParseResult = ParseSuccess | ParseFailure;
export interface ParseContext {
    stage: ReviewStage;
    config: ResolvedConfig;
    /** previous_round_resolved provided by caller; required when stage='fix'. */
    hasPreviousRoundResolved: boolean;
}
export declare function parseCodexOutput(rawText: string, ctx: ParseContext): ParseResult;
/**
 * Evaluate the predicate table (§3.0.1.B) using verdict_factors.
 * Returns the verdict the predicate table would pick, or null if no clear answer
 * (e.g., No-Go is subjective; predicate cannot infer it from factors alone).
 */
export declare function evaluatePredicate(stage: ReviewStage, declaredVerdict: AnyVerdict, f: VerdictFactors, config: ResolvedConfig): AnyVerdict | null;
/** Tiebreakers per §3.0.1.F. */
export declare function applyTiebreakers(stage: ReviewStage, current: AnyVerdict, factors: VerdictFactors, config: ResolvedConfig): AnyVerdict;
/**
 * Returns true if `candidate` is more conservative than `current`, given the stage's ordering:
 *  design: Go < Go-after-fixes < Rereview-after-fixes < No-Go
 *  code:   Pass < Pass-after-fixes < Rereview-after-fixes < No-Go
 *  fix:    All-fixed < Partial < New-issues < Rereview-after-fixes < No-Go
 */
export declare function isMoreConservative(stage: ReviewStage, candidate: AnyVerdict, current: AnyVerdict): boolean;
//# sourceMappingURL=output-parser.d.ts.map