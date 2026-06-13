import type { ResolvedConfig } from "./config.js";
export interface MinSafetyPolicy {
    readonly sandboxMode: "read-only";
    readonly approvalPolicy: "never";
    readonly network: false;
    readonly webSearch: false;
    /** Regex applied to every fix-text emitted by Codex; matches reject the conclusion. */
    readonly outputParserDangerVerbsRegex: RegExp;
    readonly defaultDesignMechanicalMaxSections: 8;
    readonly defaultCodeMechanicalMaxFixLines: 100;
    readonly defaultCodeMechanicalMaxModules: 1;
}
export declare const MIN_SAFETY_POLICY: MinSafetyPolicy;
export declare class SafetyPolicyViolation extends Error {
    readonly violations: readonly string[];
    constructor(violations: readonly string[]);
}
/**
 * Validates that the loaded config does NOT relax MIN_SAFETY_POLICY.
 * Throws SafetyPolicyViolation on any violation; caller must exit the process.
 *
 * Specifically:
 *   - SDK ThreadOption keys (sandboxMode/approvalPolicy/network/webSearch) — these are not
 *     in the user-facing config (server hard-codes them when calling Codex SDK), but if
 *     the project config schema ever exposes them via passthrough, we still defend.
 *   - circuit_breakers thresholds — design_mechanical_max_sections / code_mechanical_max_fix_lines /
 *     code_mechanical_max_modules: project config may only shrink to a smaller value.
 */
export declare function enforceMinSafetyPolicy(config: ResolvedConfig, rawConfig: unknown): void;
/**
 * Compose the effective danger-verb regex from MIN_SAFETY_POLICY plus any project-supplied addition.
 * Project config can only ADD to the regex, never replace.
 */
export declare function effectiveDangerVerbsRegex(config: ResolvedConfig): RegExp;
//# sourceMappingURL=safety.d.ts.map