import type { ResolvedConfig } from "./config.js";
export type ContextSeverity = "ok" | "warn" | "force-rebuild" | "exhausted";
export interface ContextDecision {
    severity: ContextSeverity;
    usagePct: number;
    message: string;
}
/**
 * Decide what to do based on current context_usage_pct.
 *   < warn_pct:                 ok
 *   warn_pct ≤ x < force_pct:   warn (caller may surface; no action)
 *   ≥ force_pct (first hit):    force-rebuild (caller archives + opens new thread)
 *   ≥ warn_pct after rebuild:   exhausted (caller triggers context_exhausted breaker)
 */
export declare function decideContext(config: ResolvedConfig, usagePct: number, alreadyRebuiltThisCall?: boolean): ContextDecision;
/**
 * Estimate token usage given a character count.
 * Coarse fallback when SDK does not expose `usage` for a turn:
 *   tokens ≈ chars / 4
 */
export declare function estimateTokensFromChars(chars: number): number;
//# sourceMappingURL=context-monitor.d.ts.map