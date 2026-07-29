// Single machine authority for the Phase 1 Codex/Claude flow and tier control surface.
// Checked-in Markdown/JSON artifacts are deterministic renders of this module.

export const CONTROL_SURFACE_SCHEMA_V1 = 1 as const;
export const CONTROL_SURFACE_CONTRACT_VERSION_V1 = 1 as const;
export const MIN_CODEX_SKILL_HOST_VERSION = "0.145.0-alpha.2" as const;
export const CANONICAL_CODEX_SKILL_ROOT = ".agents/skills" as const;
export const LEGACY_CODEX_SKILL_ROOT = ".codex/skills" as const;

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
  locale: "en" | "zh-CN",
): string {
  const suffixes = SIMPLIFY_CONTRACT_V1.code_suffixes
    .map((suffix) => `\`${suffix}\``)
    .join(", ");
  const segments = SIMPLIFY_CONTRACT_V1.diff_segments.join(" + ");
  if (locale === "zh-CN") {
    return [
      `- code 路径 allowlist：${suffixes}；`,
      `- 相对 base ref \`${SIMPLIFY_CONTRACT_V1.base_ref}\` 的 ${segments} diff 中，allowlist code 的 add+del 合计达到 \`${SIMPLIFY_CONTRACT_V1.line_threshold}\` 行时触发；`,
      `- 非 git 仓库、缺少 \`${SIMPLIFY_CONTRACT_V1.base_ref}\`、detached HEAD、纯文档/SOP/typo，或 allowlist code 未达阈值时豁免。`,
    ].join("\n");
  }
  return [
    `- Code-path allowlist: ${suffixes}.`,
    `- Trigger when allowlisted code reaches \`${SIMPLIFY_CONTRACT_V1.line_threshold}\` total add+del lines across the ${segments} diff against base ref \`${SIMPLIFY_CONTRACT_V1.base_ref}\`.`,
    `- Exempt when this is not a git repository, \`${SIMPLIFY_CONTRACT_V1.base_ref}\` is absent, HEAD is detached, the change is docs/SOP/typo only, or allowlisted code stays below the threshold.`,
  ].join("\n");
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

export function renderFlowContract(locale: "en" | "zh-CN"): string {
  if (locale === "zh-CN") {
    return renderLines([
      "# ccsop flow contract v1",
      "",
      "- Claude 命令入口只接受 `claude+claude` / `claude+codex`。",
      "- Codex skill 入口只接受 `codex+codex` / `codex+claude`。",
      "- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。",
      "- tool 缺失、旧 bridge 或未重启：零写并提示 `/mcp` 重连/重启。",
      "- invalid config 的 status 返回 error/raw owners；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。",
      "- `codex+claude` 在 Phase 1 的 delivery 是 `manual relay`。",
      "- 配置 schema 必须为 `1`；禁止 shell 或手改 TOML fallback。",
    ]);
  }
  return renderLines([
    "# ccsop flow contract v1",
    "",
    "- The Claude command accepts only `claude+claude` / `claude+codex`.",
    "- The Codex skill accepts only `codex+codex` / `codex+claude`.",
    "- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.",
    "- A missing, old, or unrestarted bridge causes zero writes and `/mcp` reconnect guidance.",
    "- Invalid-config status returns the error/raw owners; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.",
    "- `codex+claude` delivery is `manual relay` in Phase 1.",
    "- Config schema must be `1`; shell and manual-TOML fallbacks are forbidden.",
  ]);
}

export function renderTierContract(locale: "en" | "zh-CN"): string {
  if (locale === "zh-CN") {
    return renderLines([
      "# ccsop tier contract v1",
      "",
      "- `claude-review` → `[review.claude] backend/model/effort`。",
      "- `codex-review` → `[review.codex] model/effort`。",
      "- `codex-dispatch` → `[implement] model/effort`（只控制 `codex_implement`）。",
      "- `codex-default` → `[codex] default_model/default_effort`。",
      "- 当前 Codex host session 的模型/effort 用内置 `/model`。",
      "- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。",
      "- invalid config 的 status 返回 error/raw tiers；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。",
      "- Phase 1 不接受未发布的 implement scope。",
    ]);
  }
  return renderLines([
    "# ccsop tier contract v1",
    "",
    "- `claude-review` → `[review.claude] backend/model/effort`.",
    "- `codex-review` → `[review.codex] model/effort`.",
    "- `codex-dispatch` → `[implement] model/effort` (`codex_implement` only).",
    "- `codex-default` → `[codex] default_model/default_effort`.",
    "- Use the built-in `/model` for the current Codex host session model/effort.",
    "- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.",
    "- Invalid-config status returns the error/raw tiers; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.",
    "- Phase 1 rejects every unpublished implement scope.",
  ]);
}

export function renderCodexSkillHostContract(
  locale: "en" | "zh-CN",
): string {
  const names = CONTROL_SURFACE_CONTRACT_V1.skills.names
    .map((name) => `\`${name}\``)
    .join(", ");
  if (locale === "zh-CN") {
    return renderLines([
      "# ccsop Codex skill host contract v1",
      "",
      `- 最低 Codex CLI：\`${MIN_CODEX_SKILL_HOST_VERSION}\`（按标准 semver prerelease 排序）。`,
      `- canonical root：\`${CANONICAL_CODEX_SKILL_ROOT}\`；legacy root：\`${LEGACY_CODEX_SKILL_ROOT}\`。`,
      `- 必须存在的五个 discoverable entries：${names}。`,
      "- 低于最低版本、缺失或无法解析的 host：保留现有 bytes/pointer，禁止创建 canonical duplicate。",
      `- legacy migration 仅限 pristine provenance；回滚入口：\`${CONTROL_SURFACE_CONTRACT_V1.skills.rollback_flag}\`。`,
    ]);
  }
  return renderLines([
    "# ccsop Codex skill host contract v1",
    "",
    `- Minimum Codex CLI: \`${MIN_CODEX_SKILL_HOST_VERSION}\` using standard semver prerelease ordering.`,
    `- Canonical root: \`${CANONICAL_CODEX_SKILL_ROOT}\`; legacy root: \`${LEGACY_CODEX_SKILL_ROOT}\`.`,
    `- Required five discoverable entries: ${names}.`,
    "- A below-minimum, missing, or unparseable host preserves existing bytes/pointer and creates no canonical duplicate.",
    `- Legacy migration is pristine-provenance only; rollback entry: \`${CONTROL_SURFACE_CONTRACT_V1.skills.rollback_flag}\`.`,
  ]);
}
