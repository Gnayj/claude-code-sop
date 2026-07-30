// Single machine authority for the Phase 1 Codex/Claude flow and tier control surface.
// Checked-in Markdown/JSON artifacts are deterministic renders of this module.

export const CONTROL_SURFACE_SCHEMA_V1 = 1 as const;
export const CONTROL_SURFACE_CONTRACT_VERSION_V1 = 1 as const;
export const CONTROL_SURFACE_SCHEMA_V2 = 2 as const;
export const CONTROL_SURFACE_CONTRACT_VERSION_V2 = 2 as const;
export const MIN_CODEX_SKILL_HOST_VERSION = "0.145.0-alpha.2" as const;
export const CANONICAL_CODEX_SKILL_ROOT = ".agents/skills" as const;
export const LEGACY_CODEX_SKILL_ROOT = ".codex/skills" as const;

export const MAINTAINED_LANGUAGE_ALIASES = {
  "zh-CN": ["zh", "zh-CN", "zh_CN", "zh-Hans", "zh_Hans"],
  "de-DE": ["de", "de-DE", "de_DE"],
} as const;
export type MaintainedLocale = keyof typeof MAINTAINED_LANGUAGE_ALIASES;
export type RenderLocale = "en" | MaintainedLocale;
export type LanguageResolution =
  | { status: "valid"; canonical: string; maintained: boolean }
  | { status: "invalid" };

const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const MAINTAINED_LANGUAGE_LOOKUP = new Map<string, MaintainedLocale>(
  Object.entries(MAINTAINED_LANGUAGE_ALIASES).flatMap(
    ([canonical, aliases]) =>
      aliases.map((alias) => [
        alias.replaceAll("_", "-").toLowerCase(),
        canonical as MaintainedLocale,
      ]),
  ),
);

/**
 * Single language-resolution authority for command contracts and lifecycle fixtures.
 * Known aliases canonicalize; valid unmaintained tags preserve the caller's trimmed bytes.
 */
export function resolveLanguage(
  value: string | undefined,
): LanguageResolution {
  const trimmed = value?.trim();
  if (!trimmed) return { status: "invalid" };
  const lookup = trimmed.replaceAll("_", "-").toLowerCase();
  if (lookup === "en") {
    return { status: "valid", canonical: "en", maintained: false };
  }
  const canonical = MAINTAINED_LANGUAGE_LOOKUP.get(lookup);
  if (canonical) {
    return { status: "valid", canonical, maintained: true };
  }
  if (!LANGUAGE_TAG_PATTERN.test(lookup)) return { status: "invalid" };
  return { status: "valid", canonical: trimmed, maintained: false };
}

export const CODEX_EFFORT_VALUES = [
  "",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export const CLAUDE_EFFORT_VALUES = [
  "",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const FLOW_VALUES = [
  "claude+claude",
  "claude+codex",
  "codex+codex",
  "codex+claude",
] as const;
export type ControlSurfaceFlow = (typeof FLOW_VALUES)[number];

export const PHASE1_TIER_SCOPES = [
  "claude-review",
  "codex-review",
  "codex-dispatch",
  "codex-default",
] as const;
export type Phase1TierScope = (typeof PHASE1_TIER_SCOPES)[number];

export const PHASE2_TIER_SCOPES = [
  ...PHASE1_TIER_SCOPES,
  "claude-implement",
] as const;
export type Phase2TierScope = (typeof PHASE2_TIER_SCOPES)[number];

export const CONTROL_SURFACE_CONTRACT_V1 = {
  schema_version: CONTROL_SURFACE_SCHEMA_V1,
  contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V1,
  actions: ["status", "stamp-schema-v1", "set-flow", "set-tier"] as const,
  mutation_gate: {
    implicit: "read-only",
    explicit: "tool-only",
    shell_fallback: false,
    manual_toml_fallback: false,
  },
  flows: {
    "claude+claude": {
      entrypoint: "claude-command",
      design_owner: "claude",
      implement_owner: "claude",
      codex_implement_enabled: false,
    },
    "claude+codex": {
      entrypoint: "claude-command",
      design_owner: "claude",
      implement_owner: "codex",
      codex_implement_enabled: true,
    },
    "codex+codex": {
      entrypoint: "codex-skill",
      design_owner: "codex",
      implement_owner: "codex",
      codex_implement_enabled: "unchanged",
    },
    "codex+claude": {
      entrypoint: "codex-skill",
      design_owner: "codex",
      implement_owner: "claude",
      codex_implement_enabled: "unchanged",
      delivery: "manual relay",
    },
  },
  tiers: {
    "claude-review": {
      section: "review.claude",
      keys: ["backend", "model", "effort"],
      effort_values: CLAUDE_EFFORT_VALUES,
    },
    "codex-review": {
      section: "review.codex",
      keys: ["model", "effort"],
      effort_values: CODEX_EFFORT_VALUES,
    },
    "codex-dispatch": {
      section: "implement",
      keys: ["model", "effort"],
      effort_values: CODEX_EFFORT_VALUES,
    },
    "codex-default": {
      section: "codex",
      keys: ["default_model", "default_effort"],
      effort_values: CODEX_EFFORT_VALUES,
    },
  },
  host_model_control: "/model",
  skills: {
    canonical_root: CANONICAL_CODEX_SKILL_ROOT,
    legacy_root: LEGACY_CODEX_SKILL_ROOT,
    minimum_codex_cli: MIN_CODEX_SKILL_HOST_VERSION,
    names: ["project-sop", "handoff", "simplify", "sop-flow", "sop-tier"],
    legacy_migration: "pristine-only",
    rollback_flag: "--rollback-codex-skills",
  },
} as const;

export const CLAUDE_IMPLEMENT_DEFAULTS_V2 = {
  enabled: false,
  backend: "cli",
  model: "opus",
  effort: "max",
  cli_path: "",
  timeout_seconds: 900,
  max_output_bytes: 1_048_576,
  max_budget_usd: 5,
  supported_version_range: ">=2.1.220 <2.2.0",
  allow_uncertified_version: false,
  max_dispatches_per_design: 3,
  max_cumulative_wall_seconds: 3_600,
  max_cumulative_budget_usd: 20,
  max_daily_budget_usd: 50,
  validation_commands: [] as readonly (readonly string[])[],
  validation_definition_paths: [] as readonly string[],
  validation_additive_test_globs: [] as readonly string[],
  allow_advisory_apply: false,
} as const;

export const CLAUDE_IMPLEMENT_AGENT_MUTABLE_KEYS = [
  "model",
  "effort",
  "timeout_seconds",
  "max_output_bytes",
  "max_budget_usd",
  "max_dispatches_per_design",
  "max_cumulative_wall_seconds",
  "max_cumulative_budget_usd",
  "max_daily_budget_usd",
] as const;

export const CLAUDE_IMPLEMENT_SHRINK_ONLY_KEYS = [
  "timeout_seconds",
  "max_output_bytes",
  "max_budget_usd",
  "max_dispatches_per_design",
  "max_cumulative_wall_seconds",
  "max_cumulative_budget_usd",
  "max_daily_budget_usd",
] as const;

export const CONTROL_SURFACE_CONTRACT_V2 = {
  ...CONTROL_SURFACE_CONTRACT_V1,
  schema_version: CONTROL_SURFACE_SCHEMA_V2,
  contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
  actions: [
    ...CONTROL_SURFACE_CONTRACT_V1.actions,
    "migrate-schema-v2",
    "rollback-schema-v1",
    "disable-claude-implement",
  ] as const,
  flows: {
    ...CONTROL_SURFACE_CONTRACT_V1.flows,
    "codex+claude": {
      ...CONTROL_SURFACE_CONTRACT_V1.flows["codex+claude"],
      delivery: "claude_implement proposal",
      claude_implement_enable: "operator-only",
    },
  },
  tiers: {
    ...CONTROL_SURFACE_CONTRACT_V1.tiers,
    "claude-implement": {
      section: "implement.claude",
      keys: CLAUDE_IMPLEMENT_AGENT_MUTABLE_KEYS,
      shrink_only: CLAUDE_IMPLEMENT_SHRINK_ONLY_KEYS,
      effort_values: CLAUDE_EFFORT_VALUES,
    },
  },
  claude_implement: {
    tool: "claude_implement",
    exact_gate: {
      control_surface_schema: 2,
      design_owner: "codex",
      implement_owner: "claude",
      enabled: true,
    },
    enable: "operator-only",
    disable_action: "disable-claude-implement",
    backend: "cli",
    tools: ["Read", "Edit", "Write"],
    defaults: CLAUDE_IMPLEMENT_DEFAULTS_V2,
  },
} as const;

export const SIMPLIFY_CONTRACT_V1 = {
  schema_version: 1,
  base_ref: "main",
  line_threshold: 30,
  code_suffixes: [".go", ".vue", ".ts", ".tsx", ".js", ".py", ".sh"],
  diff_segments: ["committed", "staged", "unstaged", "untracked"],
  corners: ["reuse", "quality", "efficiency", "coverage"],
  implicit_mode: "diagnose-only",
  explicit_mode: "diagnose-fix-retest",
} as const;

/** Stable row/status tokens binding the model-executed lifecycle matrix to its temp-repo suite. */
export const CODEX_SKILL_LIFECYCLE_FIXTURE_BINDINGS = {
  C1: "skipped (Codex not in use)",
  C2: "host-gate-conflict",
  C3: "legacy-backup+canonical-publish",
  C4: "legacy-skill-unknown-provenance",
  C5: "legacy-skill-migration-conflict",
  C6: "legacy-canonical-divergence",
  C7: "canonical-pristine-update",
  C8: "preserved (consumer-owned)",
  C9: "rolled-back",
  C10: "up-to-date",
  C11: "unfinished (scoped)",
  C12: "canonical-absent",
  C13: "canonical-language-update",
  C14: "canonical-language-preserved",
  C15: "canonical-language-up-to-date",
} as const;

export function renderSimplifyContract(): typeof SIMPLIFY_CONTRACT_V1 {
  return SIMPLIFY_CONTRACT_V1;
}

export function renderSimplifyReadableCriteria(
  locale: RenderLocale,
): string {
  const suffixes = SIMPLIFY_CONTRACT_V1.code_suffixes
    .map((suffix) => `\`${suffix}\``)
    .join(", ");
  const segments = SIMPLIFY_CONTRACT_V1.diff_segments.join(" + ");
  switch (locale) {
    case "zh-CN":
      return [
        `- code 路径 allowlist：${suffixes}；`,
        `- 相对 base ref \`${SIMPLIFY_CONTRACT_V1.base_ref}\` 的 ${segments} diff 中，allowlist code 的 add+del 合计达到 \`${SIMPLIFY_CONTRACT_V1.line_threshold}\` 行时触发；`,
        `- 非 git 仓库、缺少 \`${SIMPLIFY_CONTRACT_V1.base_ref}\`、detached HEAD、纯文档/SOP/typo，或 allowlist code 未达阈值时豁免。`,
      ].join("\n");
    case "de-DE":
      return [
        `- Allowlist für Codepfade: ${suffixes}.`,
        `- Auslösen, sobald die Summe aus hinzugefügten und entfernten Zeilen des erlaubten Codes im Diff aus ${segments} gegen die Basisreferenz \`${SIMPLIFY_CONTRACT_V1.base_ref}\` insgesamt \`${SIMPLIFY_CONTRACT_V1.line_threshold}\` erreicht.`,
        `- Ausgenommen sind Nicht-Git-Repositories, eine fehlende Basisreferenz \`${SIMPLIFY_CONTRACT_V1.base_ref}\`, ein detached HEAD, reine Dokumentations-/SOP-/Tippfehleränderungen oder Fälle, in denen der erlaubte Code unterhalb des Schwellenwerts bleibt.`,
      ].join("\n");
    case "en":
      return [
        `- Code-path allowlist: ${suffixes}.`,
        `- Trigger when allowlisted code reaches \`${SIMPLIFY_CONTRACT_V1.line_threshold}\` total add+del lines across the ${segments} diff against base ref \`${SIMPLIFY_CONTRACT_V1.base_ref}\`.`,
        `- Exempt when this is not a git repository, \`${SIMPLIFY_CONTRACT_V1.base_ref}\` is absent, HEAD is detached, the change is docs/SOP/typo only, or allowlisted code stays below the threshold.`,
      ].join("\n");
    default:
      return assertNeverLocale(locale);
  }
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
  normalized: string;
}

export type CodexSkillHostVersionResult =
  | { status: "supported"; version: string }
  | { status: "below-minimum"; version: string }
  | { status: "missing" | "unparseable" };

function parseSemverFromText(text: string): ParsedSemver | null {
  const match = text.match(
    /(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?(?:$|[^0-9A-Za-z.+-])/,
  );
  if (!match) return null;
  const prerelease = match[4]
    ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    normalized: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}`,
  };
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined || r === undefined) {
      if (l === r) return 0;
      return l === undefined ? -1 : 1;
    }
    if (l === r) continue;
    if (typeof l === "number" && typeof r === "string") return -1;
    if (typeof l === "string" && typeof r === "number") return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * Deterministic host gate shared by lifecycle fixtures. Missing/unparseable output is distinct
 * from a known-old CLI so callers can report the right preserve-only conflict.
 */
export function classifyCodexSkillHostVersion(
  versionOutput: string | undefined,
): CodexSkillHostVersionResult {
  if (versionOutput === undefined || versionOutput.trim() === "") {
    return { status: "missing" };
  }
  const observed = parseSemverFromText(versionOutput);
  const minimum = parseSemverFromText(MIN_CODEX_SKILL_HOST_VERSION);
  if (!observed || !minimum) return { status: "unparseable" };
  return compareSemver(observed, minimum) >= 0
    ? { status: "supported", version: observed.normalized }
    : { status: "below-minimum", version: observed.normalized };
}

function renderLines(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

function assertNeverLocale(locale: never): never {
  throw new Error(`unsupported render locale: ${String(locale)}`);
}

export function renderFlowContract(locale: RenderLocale): string {
  switch (locale) {
    case "zh-CN":
      return renderLines([
        "# ccsop flow contract v2",
        "",
        "- Claude 命令入口只接受 `claude+claude` / `claude+codex`。",
        "- Codex skill 入口只接受 `codex+codex` / `codex+claude`。",
        "- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。",
        "- tool 缺失、旧 bridge 或未重启：零写并提示 `/mcp` 重连/重启。",
        "- invalid config 的 status 返回 error/raw owners；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。",
        "- schema=1 保持 Phase 1：`codex+claude` delivery 为 `manual relay`，flow/Codex tier 仍可用。",
        "- schema=2 且 bridge catalog 含 `claude_implement` 时，`codex+claude` 可使用 proposal adapter；flow 永不自动 enable。",
        "- implement owner 变化会原子强制 `[implement.claude].enabled=false`；重新 enable 只能由 operator 在 agent session 外完成。",
        "- 禁止 shell 或手改 TOML fallback；schema 迁移/回滚只调用 server-fixed action。",
      ]);
    case "de-DE":
      return renderLines([
        "# ccsop flow contract v2",
        "",
        "- Der Claude-Befehl akzeptiert nur `claude+claude` / `claude+codex`.",
        "- Der Codex-Skill akzeptiert nur `codex+codex` / `codex+claude`.",
        "- Leere Argumente und implizite Aufrufe sind schreibgeschützt; explizites Setzen ruft `ccsop_configure` auf.",
        "- Eine fehlende, alte oder nicht neu gestartete Bridge führt zu null Schreibvorgängen und einem Hinweis zum erneuten Verbinden über `/mcp`.",
        "- Der Status einer ungültigen Konfiguration liefert Fehler/Rohwerte der Owner; explizites Setzen repariert Zielschlüssel nur nach erfolgreicher Gesamtvalidierung, andernfalls gibt es null Schreibvorgänge.",
        "- Schema 1 erhält Phase 1: `codex+claude` verwendet `manual relay`; Flow- und Codex-Tiers bleiben nutzbar.",
        "- Mit Schema 2 und `claude_implement` im Bridge-Katalog kann `codex+claude` den Proposal-Adapter verwenden; der Flow aktiviert ihn nie automatisch.",
        "- Ein Wechsel des Implementierungs-Owners erzwingt atomar `[implement.claude].enabled=false`; nur ein Operator außerhalb der Agent-Session darf ihn wieder aktivieren.",
        "- Shell-/manuelle-TOML-Fallbacks sind verboten; Schema-Migration und Rollback verwenden ausschließlich serverseitig festgelegte Aktionen.",
      ]);
    case "en":
      return renderLines([
        "# ccsop flow contract v2",
        "",
        "- The Claude command accepts only `claude+claude` / `claude+codex`.",
        "- The Codex skill accepts only `codex+codex` / `codex+claude`.",
        "- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.",
        "- A missing, old, or unrestarted bridge causes zero writes and `/mcp` reconnect guidance.",
        "- Invalid-config status returns the error/raw owners; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.",
        "- Schema 1 preserves Phase 1: `codex+claude` is manual relay and flow/Codex tiers remain usable.",
        "- With schema 2 and `claude_implement` in the bridge catalog, `codex+claude` can use the proposal adapter; flow never auto-enables it.",
        "- Changing implement owner atomically forces `[implement.claude].enabled=false`; only an operator outside the agent session may re-enable it.",
        "- Shell/manual-TOML fallbacks are forbidden; schema migration and rollback use server-fixed actions only.",
      ]);
    default:
      return assertNeverLocale(locale);
  }
}

export function renderTierContract(locale: RenderLocale): string {
  switch (locale) {
    case "zh-CN":
      return renderLines([
        "# ccsop tier contract v2",
        "",
        "- `claude-review` → `[review.claude] backend/model/effort`。",
        "- `codex-review` → `[review.codex] model/effort`。",
        "- `codex-dispatch` → `[implement] model/effort`（只控制 `codex_implement`）。",
        "- `codex-default` → `[codex] default_model/default_effort`。",
        "- schema=2 新增 `claude-implement` → `[implement.claude]` model/effort 与 shrink-only timeout/output/budget/ledger cap。",
        "- backend/cli_path/version override/validation/additive globs/advisory apply/enabled 全部 operator-only，tool 拒绝。",
        "- 当前 Codex host session 的模型/effort 用内置 `/model`。",
        "- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。",
        "- invalid config 的 status 返回 error/raw tiers；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。",
        "- schema=1 继续拒绝 `claude-implement`；schema=2 还要求 catalog 中真实存在 `claude_implement`。",
      ]);
    case "de-DE":
      return renderLines([
        "# ccsop tier contract v2",
        "",
        "- `claude-review` → `[review.claude] backend/model/effort`.",
        "- `codex-review` → `[review.codex] model/effort`.",
        "- `codex-dispatch` → `[implement] model/effort` (steuert nur `codex_implement`).",
        "- `codex-default` → `[codex] default_model/default_effort`.",
        "- Schema 2 ergänzt `claude-implement` → model/effort in `[implement.claude]` sowie nur verkleinerbare timeout/output/budget/ledger-Grenzen.",
        "- backend/cli_path/Versions-Overrides/Validierung/additive Globs/advisory apply/enabled sind operator-only und werden vom Tool abgelehnt.",
        "- Für Modell/effort der aktuellen Codex-Host-Session ist das integrierte `/model` zu verwenden.",
        "- Leere Argumente und implizite Aufrufe sind schreibgeschützt; explizites Setzen ruft `ccsop_configure` auf.",
        "- Der Status einer ungültigen Konfiguration liefert Fehler/Rohwerte der Tiers; explizites Setzen repariert Zielschlüssel nur nach erfolgreicher Gesamtvalidierung, andernfalls gibt es null Schreibvorgänge.",
        "- Schema 1 lehnt `claude-implement` weiterhin ab; Schema 2 verlangt zusätzlich ein echtes Tool `claude_implement` im Katalog.",
      ]);
    case "en":
      return renderLines([
        "# ccsop tier contract v2",
        "",
        "- `claude-review` → `[review.claude] backend/model/effort`.",
        "- `codex-review` → `[review.codex] model/effort`.",
        "- `codex-dispatch` → `[implement] model/effort` (`codex_implement` only).",
        "- `codex-default` → `[codex] default_model/default_effort`.",
        "- Schema 2 adds `claude-implement` → `[implement.claude]` model/effort and shrink-only timeout/output/budget/ledger caps.",
        "- backend/cli_path/version overrides/validation/additive globs/advisory apply/enabled are operator-only and rejected by the tool.",
        "- Use the built-in `/model` for the current Codex host session model/effort.",
        "- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.",
        "- Invalid-config status returns the error/raw tiers; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.",
        "- Schema 1 still rejects `claude-implement`; schema 2 also requires a real `claude_implement` tool in the catalog.",
      ]);
    default:
      return assertNeverLocale(locale);
  }
}

export function renderCodexSkillHostContract(
  locale: RenderLocale,
): string {
  const names = CONTROL_SURFACE_CONTRACT_V1.skills.names
    .map((name) => `\`${name}\``)
    .join(", ");
  switch (locale) {
    case "zh-CN":
      return renderLines([
        "# ccsop Codex skill host contract v1",
        "",
        `- 最低 Codex CLI：\`${MIN_CODEX_SKILL_HOST_VERSION}\`（按标准 semver prerelease 排序）。`,
        `- canonical root：\`${CANONICAL_CODEX_SKILL_ROOT}\`；legacy root：\`${LEGACY_CODEX_SKILL_ROOT}\`。`,
        `- 必须存在的五个 discoverable entries：${names}。`,
        "- 低于最低版本、缺失或无法解析的 host：保留现有 bytes/pointer，禁止创建 canonical duplicate。",
        `- legacy migration 仅限 pristine provenance；回滚入口：\`${CONTROL_SURFACE_CONTRACT_V1.skills.rollback_flag}\`。`,
      ]);
    case "de-DE":
      return renderLines([
        "# ccsop Codex skill host contract v1",
        "",
        `- Minimale Codex CLI: \`${MIN_CODEX_SKILL_HOST_VERSION}\` nach standardmäßiger semver-Prerelease-Sortierung.`,
        `- Kanonisches Root: \`${CANONICAL_CODEX_SKILL_ROOT}\`; Legacy-Root: \`${LEGACY_CODEX_SKILL_ROOT}\`.`,
        `- Erforderliche fünf auffindbare Einträge: ${names}.`,
        "- Ein zu alter, fehlender oder nicht auswertbarer Host bewahrt vorhandene Bytes/Pointer und erzeugt kein kanonisches Duplikat.",
        `- Die Legacy-Migration ist auf pristine Provenance beschränkt; Rollback-Einstieg: \`${CONTROL_SURFACE_CONTRACT_V1.skills.rollback_flag}\`.`,
      ]);
    case "en":
      return renderLines([
        "# ccsop Codex skill host contract v1",
        "",
        `- Minimum Codex CLI: \`${MIN_CODEX_SKILL_HOST_VERSION}\` using standard semver prerelease ordering.`,
        `- Canonical root: \`${CANONICAL_CODEX_SKILL_ROOT}\`; legacy root: \`${LEGACY_CODEX_SKILL_ROOT}\`.`,
        `- Required five discoverable entries: ${names}.`,
        "- A below-minimum, missing, or unparseable host preserves existing bytes/pointer and creates no canonical duplicate.",
        `- Legacy migration is pristine-provenance only; rollback entry: \`${CONTROL_SURFACE_CONTRACT_V1.skills.rollback_flag}\`.`,
      ]);
    default:
      return assertNeverLocale(locale);
  }
}
