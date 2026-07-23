// Server-side MIN_SAFETY_POLICY enforcement.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §6.1.3 + §15.7 M4
// Project config (.codex-review/config.toml) may TIGHTEN these constraints
// but MAY NOT RELAX them. Any relaxation attempt -> process exit at startup.

import type { ResolvedConfig } from "./config.js";

export interface MinSafetyPolicy {
  readonly sandboxMode: "read-only";
  readonly approvalPolicy: "never";
  readonly network: false;
  readonly webSearch: false;
  /** Regex applied to every fix-text emitted by Codex; matches reject the conclusion. */
  readonly outputParserDangerVerbsRegex: RegExp;
  // Round 3 thresholds — only shrink-only against these defaults.
  readonly defaultDesignMechanicalMaxSections: 8;
  readonly defaultCodeMechanicalMaxFixLines: 100;
  readonly defaultCodeMechanicalMaxModules: 1;
}

export const MIN_SAFETY_POLICY: MinSafetyPolicy = {
  sandboxMode: "read-only",
  approvalPolicy: "never",
  network: false,
  webSearch: false,
  outputParserDangerVerbsRegex:
    /\b(git\s+(commit|push|reset|checkout)|rm|mv|chmod|curl|wget)\b/,
  defaultDesignMechanicalMaxSections: 8,
  defaultCodeMechanicalMaxFixLines: 100,
  defaultCodeMechanicalMaxModules: 1,
};

// ---------- Per-tool-class tiering (design ccsop-codex-implement §4.3 / §6.1) ----------
// The REVIEW class keeps MIN_SAFETY_POLICY above byte-for-byte (test-pinned; nothing in the
// implement feature touches review construction paths). The IMPLEMENT class gets its own
// write-tier minimum: the writer may write ONLY inside its scratch workspace, never gains
// approval prompts, network, or web search, and its thresholds are shrink-only.
export interface ImplementMinPolicy {
  readonly sandboxMode: "workspace-write";
  readonly approvalPolicy: "never";
  readonly network: false;
  readonly webSearch: false;
  readonly defaultMaxImplementRounds: 3;
  readonly defaultMaxFileBytes: 2097152;
}

export const IMPLEMENT_MIN_POLICY: ImplementMinPolicy = {
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  network: false,
  webSearch: false,
  defaultMaxImplementRounds: 3,
  defaultMaxFileBytes: 2097152,
};

export class SafetyPolicyViolation extends Error {
  constructor(
    public readonly violations: readonly string[],
  ) {
    super(
      `MIN_SAFETY_POLICY violation; project config attempted to relax server-enforced constraints:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
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
export function enforceMinSafetyPolicy(
  config: ResolvedConfig,
  rawConfig: unknown,
): void {
  const violations: string[] = [];

  // 1) Threshold shrink-only checks.
  const cb = config.circuit_breakers;
  if (
    cb.design_mechanical_max_sections >
    MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections
  ) {
    violations.push(
      `circuit_breakers.design_mechanical_max_sections=${cb.design_mechanical_max_sections} ` +
        `exceeds server max ${MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections}; only shrink allowed.`,
    );
  }
  if (
    cb.code_mechanical_max_fix_lines >
    MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines
  ) {
    violations.push(
      `circuit_breakers.code_mechanical_max_fix_lines=${cb.code_mechanical_max_fix_lines} ` +
        `exceeds server max ${MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines}; only shrink allowed.`,
    );
  }
  if (
    cb.code_mechanical_max_modules >
    MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules
  ) {
    violations.push(
      `circuit_breakers.code_mechanical_max_modules=${cb.code_mechanical_max_modules} ` +
        `exceeds server max ${MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules}; only shrink allowed.`,
    );
  }

  // 1.A) Implement-class thresholds — shrink-only vs IMPLEMENT_MIN_POLICY defaults
  //      (design ccsop-codex-implement §4.3/§4.2.D: config may tighten or disable, never widen).
  const imp = config.implement;
  if (imp.max_implement_rounds > IMPLEMENT_MIN_POLICY.defaultMaxImplementRounds) {
    violations.push(
      `implement.max_implement_rounds=${imp.max_implement_rounds} ` +
        `exceeds server max ${IMPLEMENT_MIN_POLICY.defaultMaxImplementRounds}; only shrink allowed.`,
    );
  }
  if (imp.max_file_bytes > IMPLEMENT_MIN_POLICY.defaultMaxFileBytes) {
    violations.push(
      `implement.max_file_bytes=${imp.max_file_bytes} ` +
        `exceeds server max ${IMPLEMENT_MIN_POLICY.defaultMaxFileBytes}; only shrink allowed.`,
    );
  }

  // 2) Defense in depth: if project sneaks SDK ThreadOption fields into [codex] or [safety],
  //    reject any attempt to disable read-only / approval=never / network=false / web_search=false.
  //    This is a passthrough check — the schema does not currently surface these fields, but if
  //    a user adds them to TOML, raw_config will carry them through.
  const raw = rawConfig as Record<string, unknown> | undefined;
  if (raw && typeof raw === "object") {
    const codexRaw = raw["codex"] as Record<string, unknown> | undefined;
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
    const safetyRaw = raw["safety"] as Record<string, unknown> | undefined;
    if (safetyRaw) {
      checkRelaxAttempt(safetyRaw, "sandbox_mode", "read-only", violations);
      checkRelaxAttempt(safetyRaw, "approval_policy", "never", violations);
      checkRelaxAttempt(safetyRaw, "network", false, violations);
      checkRelaxAttempt(safetyRaw, "web_search", false, violations);
      checkRelaxAttempt(safetyRaw, "network_access_enabled", false, violations);
      checkRelaxAttempt(safetyRaw, "web_search_enabled", false, violations);
      checkRelaxAttempt(safetyRaw, "web_search_mode", "disabled", violations);
    }
    // Implement class: the writer tier is fixed at workspace-write/never/no-network/no-search.
    // Any raw attempt to widen (danger-full-access, approvals, network) rejects at startup.
    const implementRaw = raw["implement"] as Record<string, unknown> | undefined;
    if (implementRaw) {
      checkRelaxAttempt(implementRaw, "sandbox_mode", "workspace-write", violations);
      checkRelaxAttempt(implementRaw, "approval_policy", "never", violations);
      checkRelaxAttempt(implementRaw, "network", false, violations);
      checkRelaxAttempt(implementRaw, "web_search", false, violations);
      checkRelaxAttempt(implementRaw, "network_access_enabled", false, violations);
      checkRelaxAttempt(implementRaw, "web_search_enabled", false, violations);
      checkRelaxAttempt(implementRaw, "web_search_mode", "disabled", violations);
    }
  }

  if (violations.length > 0) {
    throw new SafetyPolicyViolation(violations);
  }
}

function checkRelaxAttempt(
  section: Record<string, unknown>,
  key: string,
  required: string | boolean,
  violations: string[],
): void {
  if (!(key in section)) return;
  const actual = section[key];
  if (actual !== required) {
    violations.push(
      `${key}=${JSON.stringify(actual)} does not match server-required ${JSON.stringify(required)}.`,
    );
  }
}

/**
 * Compose the effective danger-verb regex from MIN_SAFETY_POLICY plus any project-supplied addition.
 * Project config can only ADD to the regex, never replace.
 */
export function effectiveDangerVerbsRegex(config: ResolvedConfig): RegExp {
  const minSrc = MIN_SAFETY_POLICY.outputParserDangerVerbsRegex.source;
  const extra = config.safety.extra_danger_verbs_regex.trim();
  const combined = extra ? `(?:${minSrc})|(?:${extra})` : minSrc;
  return new RegExp(combined);
}
