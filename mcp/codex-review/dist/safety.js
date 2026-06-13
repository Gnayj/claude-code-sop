// Server-side MIN_SAFETY_POLICY enforcement.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §6.1.3 + §15.7 M4
// Project config (.codex-review/config.toml) may TIGHTEN these constraints
// but MAY NOT RELAX them. Any relaxation attempt -> process exit at startup.
export const MIN_SAFETY_POLICY = {
    sandboxMode: "read-only",
    approvalPolicy: "never",
    network: false,
    webSearch: false,
    outputParserDangerVerbsRegex: /\b(git\s+(commit|push|reset|checkout)|rm|mv|chmod|curl|wget)\b/,
    defaultDesignMechanicalMaxSections: 8,
    defaultCodeMechanicalMaxFixLines: 100,
    defaultCodeMechanicalMaxModules: 1,
};
export class SafetyPolicyViolation extends Error {
    violations;
    constructor(violations) {
        super(`MIN_SAFETY_POLICY violation; project config attempted to relax server-enforced constraints:\n` +
            violations.map((v) => `  - ${v}`).join("\n"));
        this.violations = violations;
        this.name = "SafetyPolicyViolation";
    }
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
export function enforceMinSafetyPolicy(config, rawConfig) {
    const violations = [];
    // 1) Threshold shrink-only checks.
    const cb = config.circuit_breakers;
    if (cb.design_mechanical_max_sections >
        MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections) {
        violations.push(`circuit_breakers.design_mechanical_max_sections=${cb.design_mechanical_max_sections} ` +
            `exceeds server max ${MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections}; only shrink allowed.`);
    }
    if (cb.code_mechanical_max_fix_lines >
        MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines) {
        violations.push(`circuit_breakers.code_mechanical_max_fix_lines=${cb.code_mechanical_max_fix_lines} ` +
            `exceeds server max ${MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines}; only shrink allowed.`);
    }
    if (cb.code_mechanical_max_modules >
        MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules) {
        violations.push(`circuit_breakers.code_mechanical_max_modules=${cb.code_mechanical_max_modules} ` +
            `exceeds server max ${MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules}; only shrink allowed.`);
    }
    // 2) Defense in depth: if project sneaks SDK ThreadOption fields into [codex] or [safety],
    //    reject any attempt to disable read-only / approval=never / network=false / web_search=false.
    //    This is a passthrough check — the schema does not currently surface these fields, but if
    //    a user adds them to TOML, raw_config will carry them through.
    const raw = rawConfig;
    if (raw && typeof raw === "object") {
        const codexRaw = raw["codex"];
        if (codexRaw) {
            // Both internal short names and SDK actual names are checked.
            checkRelaxAttempt(codexRaw, "sandbox_mode", "read-only", violations);
            checkRelaxAttempt(codexRaw, "approval_policy", "never", violations);
            checkRelaxAttempt(codexRaw, "network", false, violations);
            checkRelaxAttempt(codexRaw, "web_search", false, violations);
            // SDK-actual field names (snake_case TOML form):
            checkRelaxAttempt(codexRaw, "network_access_enabled", false, violations);
            checkRelaxAttempt(codexRaw, "web_search_enabled", false, violations);
            checkRelaxAttempt(codexRaw, "web_search_mode", "disabled", violations);
        }
        const safetyRaw = raw["safety"];
        if (safetyRaw) {
            checkRelaxAttempt(safetyRaw, "sandbox_mode", "read-only", violations);
            checkRelaxAttempt(safetyRaw, "approval_policy", "never", violations);
            checkRelaxAttempt(safetyRaw, "network", false, violations);
            checkRelaxAttempt(safetyRaw, "web_search", false, violations);
            checkRelaxAttempt(safetyRaw, "network_access_enabled", false, violations);
            checkRelaxAttempt(safetyRaw, "web_search_enabled", false, violations);
            checkRelaxAttempt(safetyRaw, "web_search_mode", "disabled", violations);
        }
    }
    if (violations.length > 0) {
        throw new SafetyPolicyViolation(violations);
    }
}
function checkRelaxAttempt(section, key, required, violations) {
    if (!(key in section))
        return;
    const actual = section[key];
    if (actual !== required) {
        violations.push(`${key}=${JSON.stringify(actual)} does not match server-required ${JSON.stringify(required)}.`);
    }
}
/**
 * Compose the effective danger-verb regex from MIN_SAFETY_POLICY plus any project-supplied addition.
 * Project config can only ADD to the regex, never replace.
 */
export function effectiveDangerVerbsRegex(config) {
    const minSrc = MIN_SAFETY_POLICY.outputParserDangerVerbsRegex.source;
    const extra = config.safety.extra_danger_verbs_regex.trim();
    const combined = extra ? `(?:${minSrc})|(?:${extra})` : minSrc;
    return new RegExp(combined);
}
//# sourceMappingURL=safety.js.map