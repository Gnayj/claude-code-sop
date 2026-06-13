// Circuit breakers + threshold runtime constants.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §5.2 + §15.7 M4
import { MIN_SAFETY_POLICY } from "./safety.js";
export function initialBreakerState() {
    return {
        rounds: { design_review: 0, code_review: 0, fix_review: 0 },
        scope_drift_lines: 0,
        codex_failure_streak: 0,
        parser_failure_streak: 0,
        context_exhausted_triggered: false,
    };
}
export class BreakerEngine {
    config;
    constructor(config) {
        this.config = config;
        this.assertThresholdsShrinkOnly();
    }
    /** Throws on threshold relaxation; called once at construction. */
    assertThresholdsShrinkOnly() {
        const cb = this.config.circuit_breakers;
        const errs = [];
        if (cb.design_mechanical_max_sections >
            MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections) {
            errs.push(`design_mechanical_max_sections=${cb.design_mechanical_max_sections} exceeds ${MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections}`);
        }
        if (cb.code_mechanical_max_fix_lines >
            MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines) {
            errs.push(`code_mechanical_max_fix_lines=${cb.code_mechanical_max_fix_lines} exceeds ${MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines}`);
        }
        if (cb.code_mechanical_max_modules >
            MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules) {
            errs.push(`code_mechanical_max_modules=${cb.code_mechanical_max_modules} exceeds ${MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules}`);
        }
        if (errs.length > 0) {
            throw new Error("BreakerEngine: thresholds may only be shrunk, not relaxed: " + errs.join("; "));
        }
    }
    bumpRound(state, stage) {
        const next = { ...state.rounds };
        const cb = this.config.circuit_breakers;
        if (stage === "design") {
            next.design_review++;
            state.rounds = next;
            if (next.design_review > cb.max_design_review_rounds) {
                return {
                    name: "max_review_rounds",
                    message: `design_review rounds=${next.design_review} > max=${cb.max_design_review_rounds}`,
                };
            }
        }
        else if (stage === "code") {
            next.code_review++;
            state.rounds = next;
            if (next.code_review > cb.max_code_review_rounds) {
                return {
                    name: "max_review_rounds",
                    message: `code_review rounds=${next.code_review} > max=${cb.max_code_review_rounds}`,
                };
            }
        }
        else {
            next.fix_review++;
            state.rounds = next;
            if (next.fix_review > cb.max_fix_review_rounds) {
                return {
                    name: "max_review_rounds",
                    message: `fix_review rounds=${next.fix_review} > max=${cb.max_fix_review_rounds}`,
                };
            }
        }
        return null;
    }
    recordScopeDrift(state, addedLines) {
        state.scope_drift_lines += Math.max(0, addedLines);
        const t = this.config.circuit_breakers.scope_drift_lines_threshold;
        if (state.scope_drift_lines > t) {
            return {
                name: "scope_drift",
                message: `cumulative fix diff=${state.scope_drift_lines} lines > threshold=${t}`,
            };
        }
        return null;
    }
    recordCodexFailure(state) {
        state.codex_failure_streak++;
        const t = this.config.circuit_breakers.codex_failure_streak_threshold;
        if (state.codex_failure_streak >= t) {
            return {
                name: "codex_unavailable",
                message: `Codex SDK failed ${state.codex_failure_streak}× in a row (threshold=${t})`,
            };
        }
        return null;
    }
    recordCodexSuccess(state) {
        state.codex_failure_streak = 0;
    }
    recordParserFailure(state) {
        state.parser_failure_streak++;
        const t = this.config.circuit_breakers.parser_failure_streak_threshold;
        if (state.parser_failure_streak >= t) {
            return {
                name: "parser_unavailable",
                message: `output-parser fail-closed ${state.parser_failure_streak}× in a row (threshold=${t})`,
            };
        }
        return null;
    }
    recordParserSuccess(state) {
        state.parser_failure_streak = 0;
    }
    triggerContextExhausted(state) {
        state.context_exhausted_triggered = true;
        return {
            name: "context_exhausted",
            message: "thread rebuild attempted but new thread still over context_warn_pct",
        };
    }
}
//# sourceMappingURL=circuit-breakers.js.map