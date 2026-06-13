// Context-usage monitoring for thread lifecycle.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §4.4

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
export function decideContext(
  config: ResolvedConfig,
  usagePct: number,
  alreadyRebuiltThisCall = false,
): ContextDecision {
  const cb = config.circuit_breakers;
  if (usagePct < cb.context_warn_pct) {
    return {
      severity: "ok",
      usagePct,
      message: `context_usage_pct=${usagePct.toFixed(2)} < warn=${cb.context_warn_pct}`,
    };
  }
  if (usagePct < cb.context_force_new_thread_pct) {
    return {
      severity: "warn",
      usagePct,
      message:
        `context_usage_pct=${usagePct.toFixed(2)} >= warn=${cb.context_warn_pct}; ` +
        `still under force-rebuild=${cb.context_force_new_thread_pct}.`,
    };
  }
  if (alreadyRebuiltThisCall) {
    return {
      severity: "exhausted",
      usagePct,
      message:
        `context_usage_pct=${usagePct.toFixed(2)} remains >= warn=${cb.context_warn_pct} ` +
        `after thread rebuild; trigger context_exhausted breaker.`,
    };
  }
  return {
    severity: "force-rebuild",
    usagePct,
    message:
      `context_usage_pct=${usagePct.toFixed(2)} >= force-rebuild=${cb.context_force_new_thread_pct}; ` +
      `archive thread and open a new one with summary cold-start.`,
  };
}

/**
 * Estimate token usage given a character count.
 * Coarse fallback when SDK does not expose `usage` for a turn:
 *   tokens ≈ chars / 4
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}
