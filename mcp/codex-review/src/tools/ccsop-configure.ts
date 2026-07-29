import { z } from "zod";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  CLAUDE_IMPLEMENT_DEFAULTS_V2,
  CLAUDE_IMPLEMENT_SHRINK_ONLY_KEYS,
  CLAUDE_EFFORT_VALUES,
  CODEX_EFFORT_VALUES,
  CONTROL_SURFACE_CONTRACT_VERSION_V2,
  CONTROL_SURFACE_SCHEMA_V1,
  CONTROL_SURFACE_SCHEMA_V2,
  FLOW_VALUES,
  PHASE1_TIER_SCOPES,
  PHASE2_TIER_SCOPES,
  type ControlSurfaceFlow,
  type Phase1TierScope,
  type Phase2TierScope,
} from "../control-surface-contract.js";
import {
  CLAUDE_IMPLEMENT_COMPILED_MAX,
  parseConfigText,
} from "../config.js";
import {
  applyTomlUpdates,
  writeConfigAtomically,
  type TomlUpdate,
} from "../config-writer.js";
import {
  RuntimeConfigStore,
  sha256Text,
} from "../runtime-config-store.js";
import type {
  ConfigInspection,
  ValidatedConfigSnapshot,
} from "../runtime-config-store.js";

const ExpectedSha = z.string().regex(/^[a-f0-9]{64}$/);
const ExpectedMutation = { expected_config_sha256: ExpectedSha } as const;
const ConfigureInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z
    .object({
      action: z.literal("stamp-schema-v1"),
      ...ExpectedMutation,
    })
    .strict(),
  z
    .object({
      action: z.literal("migrate-schema-v2"),
      ...ExpectedMutation,
    })
    .strict(),
  z
    .object({
      action: z.literal("rollback-schema-v1"),
      ...ExpectedMutation,
    })
    .strict(),
  z
    .object({
      action: z.literal("disable-claude-implement"),
      ...ExpectedMutation,
      enabled: z.literal(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("set-flow"),
      ...ExpectedMutation,
      flow: z.enum(FLOW_VALUES),
    })
    .strict(),
  z
    .object({
      action: z.literal("set-tier"),
      ...ExpectedMutation,
      scope: z.string(),
      model: z.string().optional(),
      effort: z.string().optional(),
      backend: z.enum(["api", "cli"]).optional(),
      timeout_seconds: z.number().int().positive().optional(),
      max_output_bytes: z.number().int().positive().optional(),
      max_budget_usd: z.number().positive().optional(),
      max_dispatches_per_design: z.number().int().positive().optional(),
      max_cumulative_wall_seconds: z.number().int().positive().optional(),
      max_cumulative_budget_usd: z.number().positive().optional(),
      max_daily_budget_usd: z.number().positive().optional(),
    })
    .strict(),
]);
type ConfigureInputValue = z.infer<typeof ConfigureInput>;
type SetTierInput = Extract<ConfigureInputValue, { action: "set-tier" }>;

export interface CcsopConfigureResult {
  ok: true;
  action: z.infer<typeof ConfigureInput>["action"];
  contract_version: 2;
  observed_schema: number | null;
  before_sha256: string;
  after_sha256: string;
  changed_keys: string[];
  backup_path?: string;
  flow?: ControlSurfaceFlow;
  delivery?: "manual relay" | "claude_implement proposal";
  safety_disable?: boolean;
  migration_provenance_path?: string;
  status?: {
    config_valid: boolean;
    validation_error?: string;
    flow_mode: "legacy" | "explicit" | "invalid";
    resolved_flow?: ControlSurfaceFlow;
    design_owner?: string;
    implement_owner?: string;
    review_provider?: string;
    codex_implement_enabled?: boolean;
    claude_implement_enabled?: boolean;
    claude_implement_readiness?: {
      schema_ready: boolean;
      enabled: boolean;
      validation: "configured" | "unconfigured";
      advisory_apply: "disabled" | "operator-opt-in";
      apply_capability: "applicable-possible" | "advisory-only" | "export-only";
    };
    tiers: Record<string, Record<string, string>>;
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function get(raw: unknown, section: string, key: string): unknown {
  let cursor: unknown = raw;
  for (const part of section.split(".")) cursor = record(cursor)[part];
  return record(cursor)[key];
}

function requireExpectedSha(
  action: string,
  expected: string,
  actual: string,
): void {
  if (expected !== actual) {
    throw new Error(
      `config sha mismatch for ${action}: expected=${expected} actual=${actual}`,
    );
  }
}

function desiredUpdates(
  raw: unknown,
  candidates: readonly TomlUpdate[],
): TomlUpdate[] {
  return candidates.filter(
    (candidate) => get(raw, candidate.section, candidate.key) !== candidate.value,
  );
}

function flowUpdates(
  raw: unknown,
  flow: ControlSurfaceFlow,
  schema: number,
): { updates: TomlUpdate[]; safetyDisable: boolean } {
  const [designOwner, implementOwner] = flow.split("+") as [
    "claude" | "codex",
    "claude" | "codex",
  ];
  const candidates: TomlUpdate[] = [
    { section: "collaboration", key: "design_owner", value: designOwner },
    { section: "collaboration", key: "implement_owner", value: implementOwner },
  ];
  if (flow === "claude+codex") {
    candidates.push({ section: "implement", key: "enabled", value: true });
  } else if (flow === "claude+claude") {
    candidates.push({ section: "implement", key: "enabled", value: false });
  }
  const previousImplementOwner = get(raw, "collaboration", "implement_owner");
  const safetyDisable =
    schema === CONTROL_SURFACE_SCHEMA_V2 &&
    previousImplementOwner !== implementOwner;
  if (safetyDisable) {
    candidates.push({
      section: "implement.claude",
      key: "enabled",
      value: false,
    });
  }
  return { updates: desiredUpdates(raw, candidates), safetyDisable };
}

function tierUpdates(
  raw: unknown,
  input: SetTierInput,
  scope: Phase2TierScope,
): TomlUpdate[] {
  const numericKeys = [
    "timeout_seconds",
    "max_output_bytes",
    "max_budget_usd",
    "max_dispatches_per_design",
    "max_cumulative_wall_seconds",
    "max_cumulative_budget_usd",
    "max_daily_budget_usd",
  ] as const;
  if (
    input.model === undefined &&
    input.effort === undefined &&
    input.backend === undefined &&
    numericKeys.every((key) => input[key] === undefined)
  ) {
    throw new Error("set-tier requires at least one mutable tier field");
  }

  if (scope === "claude-implement") {
    if (input.backend !== undefined) {
      throw new Error("implement.claude.backend is operator-only");
    }
    if (
      input.effort !== undefined &&
      !CLAUDE_EFFORT_VALUES.includes(
        input.effort as (typeof CLAUDE_EFFORT_VALUES)[number],
      )
    ) {
      throw new Error(`invalid Claude effort: ${input.effort}`);
    }
    const candidates: TomlUpdate[] = [];
    if (input.model !== undefined) {
      candidates.push({
        section: "implement.claude",
        key: "model",
        value: input.model,
      });
    }
    if (input.effort !== undefined) {
      candidates.push({
        section: "implement.claude",
        key: "effort",
        value: input.effort,
      });
    }
    for (const key of numericKeys) {
      const requested = input[key];
      if (requested === undefined) continue;
      const compiledMax = CLAUDE_IMPLEMENT_COMPILED_MAX[key];
      const current = get(raw, "implement.claude", key);
      const baseline = Math.min(
        typeof current === "number" ? current : compiledMax,
        compiledMax,
      );
      if (requested > baseline) {
        throw new Error(
          `implement.claude.${key} is shrink-only: requested=${requested} baseline=${baseline}`,
        );
      }
      candidates.push({
        section: "implement.claude",
        key,
        value: requested,
      });
    }
    return desiredUpdates(raw, candidates);
  }

  if (numericKeys.some((key) => input[key] !== undefined)) {
    throw new Error(`Claude implement limits are not accepted for ${scope}`);
  }

  let section: string;
  let modelKey = "model";
  let effortKey = "effort";
  if (scope === "claude-review") {
    section = "review.claude";
    if (
      input.effort !== undefined &&
      !CLAUDE_EFFORT_VALUES.includes(
        input.effort as (typeof CLAUDE_EFFORT_VALUES)[number],
      )
    ) {
      throw new Error(`invalid Claude effort: ${input.effort}`);
    }
  } else {
    if (input.backend !== undefined) {
      throw new Error(`backend is not accepted for ${scope}`);
    }
    if (
      input.effort !== undefined &&
      !CODEX_EFFORT_VALUES.includes(
        input.effort as (typeof CODEX_EFFORT_VALUES)[number],
      )
    ) {
      throw new Error(`invalid codex effort: ${input.effort}`);
    }
    if (scope === "codex-review") section = "review.codex";
    else if (scope === "codex-dispatch") section = "implement";
    else {
      section = "codex";
      modelKey = "default_model";
      effortKey = "default_effort";
    }
  }

  const candidates: TomlUpdate[] = [];
  if (input.backend !== undefined) {
    candidates.push({ section, key: "backend", value: input.backend });
  }
  if (input.model !== undefined) {
    candidates.push({ section, key: modelKey, value: input.model });
  }
  if (input.effort !== undefined) {
    candidates.push({ section, key: effortKey, value: input.effort });
  }
  return desiredUpdates(raw, candidates);
}

function claudeReadiness(
  snapshot: Pick<ValidatedConfigSnapshot, "observedSchema" | "config">,
): NonNullable<
  NonNullable<CcsopConfigureResult["status"]>["claude_implement_readiness"]
> {
  const claude = snapshot.config.implement.claude;
  const validationConfigured =
    claude.validation_commands.length > 0 &&
    claude.validation_definition_paths.length > 0;
  return {
    schema_ready: snapshot.observedSchema === CONTROL_SURFACE_SCHEMA_V2,
    enabled: claude.enabled,
    validation: validationConfigured ? "configured" : "unconfigured",
    advisory_apply: claude.allow_advisory_apply
      ? "operator-opt-in"
      : "disabled",
    apply_capability: validationConfigured
      ? "applicable-possible"
      : claude.allow_advisory_apply
        ? "advisory-only"
        : "export-only",
  };
}

function statusResult(
  action: CcsopConfigureResult["action"],
  snapshot: ValidatedConfigSnapshot,
): CcsopConfigureResult {
  const config = snapshot.config;
  const flowIsExplicit =
    config.collaboration.design_owner !== undefined ||
    config.collaboration.implement_owner !== undefined;
  const resolvedFlow = flowIsExplicit
    ? (`${config.collaboration.design_owner ?? "claude"}+${
        config.collaboration.implement_owner ?? "claude"
      }` as ControlSurfaceFlow)
    : undefined;
  return {
    ok: true,
    action,
    contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
    observed_schema: snapshot.observedSchema ?? null,
    before_sha256: snapshot.sha256,
    after_sha256: snapshot.sha256,
    changed_keys: [],
    status: {
      config_valid: true,
      flow_mode: flowIsExplicit ? "explicit" : "legacy",
      ...(resolvedFlow ? { resolved_flow: resolvedFlow } : {}),
      ...(config.collaboration.design_owner
        ? { design_owner: config.collaboration.design_owner }
        : {}),
      ...(config.collaboration.implement_owner
        ? { implement_owner: config.collaboration.implement_owner }
        : {}),
      review_provider: config.review.provider,
      codex_implement_enabled: config.implement.enabled,
      claude_implement_enabled: config.implement.claude.enabled,
      claude_implement_readiness: claudeReadiness(snapshot),
      tiers: {
        "claude-review": {
          backend: config.review.claude.backend,
          model: config.review.claude.model,
          effort: config.review.claude.effort,
        },
        "codex-review": {
          model: config.review.codex.model,
          effort: config.review.codex.effort,
        },
        "codex-dispatch": {
          model: config.implement.model,
          effort: config.implement.effort,
        },
        "codex-default": {
          model: config.codex.default_model,
          effort: config.codex.default_effort,
        },
        "claude-implement": {
          backend: config.implement.claude.backend,
          model: config.implement.claude.model,
          effort: config.implement.claude.effort,
          timeout_seconds: String(config.implement.claude.timeout_seconds),
          max_output_bytes: String(config.implement.claude.max_output_bytes),
          max_budget_usd: String(config.implement.claude.max_budget_usd),
          max_dispatches_per_design: String(
            config.implement.claude.max_dispatches_per_design,
          ),
          max_cumulative_wall_seconds: String(
            config.implement.claude.max_cumulative_wall_seconds,
          ),
          max_cumulative_budget_usd: String(
            config.implement.claude.max_cumulative_budget_usd,
          ),
          max_daily_budget_usd: String(
            config.implement.claude.max_daily_budget_usd,
          ),
        },
      },
    },
  };
}

function rawString(raw: unknown, section: string, key: string): string | undefined {
  const value = get(raw, section, key);
  return typeof value === "string" ? value : undefined;
}

function rawStatusResult(
  action: CcsopConfigureResult["action"],
  snapshot: ConfigInspection,
  validationError: unknown,
): CcsopConfigureResult {
  const designOwner = rawString(snapshot.raw, "collaboration", "design_owner");
  const implementOwner = rawString(
    snapshot.raw,
    "collaboration",
    "implement_owner",
  );
  const ownerIsValid = (value: string | undefined): boolean =>
    value === undefined || value === "claude" || value === "codex";
  const flowIsExplicit =
    designOwner !== undefined || implementOwner !== undefined;
  const resolvedFlow =
    ownerIsValid(designOwner) && ownerIsValid(implementOwner)
      ? (`${designOwner ?? "claude"}+${implementOwner ?? "claude"}` as ControlSurfaceFlow)
      : undefined;
  const implementEnabled = get(snapshot.raw, "implement", "enabled");
  const tier = (
    section: string,
    fields: readonly string[],
  ): Record<string, string> =>
    Object.fromEntries(
      fields.flatMap((field) => {
        const value = rawString(snapshot.raw, section, field);
        return value === undefined ? [] : [[field, value]];
      }),
    );

  return {
    ok: true,
    action,
    contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
    observed_schema: snapshot.observedSchema ?? null,
    before_sha256: snapshot.sha256,
    after_sha256: snapshot.sha256,
    changed_keys: [],
    status: {
      config_valid: false,
      validation_error:
        validationError instanceof Error
          ? validationError.message
          : String(validationError),
      flow_mode:
        ownerIsValid(designOwner) && ownerIsValid(implementOwner)
          ? flowIsExplicit
            ? "explicit"
            : "legacy"
          : "invalid",
      ...(resolvedFlow ? { resolved_flow: resolvedFlow } : {}),
      ...(designOwner !== undefined ? { design_owner: designOwner } : {}),
      ...(implementOwner !== undefined ? { implement_owner: implementOwner } : {}),
      ...(rawString(snapshot.raw, "review", "provider")
        ? { review_provider: rawString(snapshot.raw, "review", "provider") }
        : {}),
      ...(typeof implementEnabled === "boolean"
        ? { codex_implement_enabled: implementEnabled }
        : {}),
      ...(typeof get(snapshot.raw, "implement.claude", "enabled") === "boolean"
        ? {
            claude_implement_enabled: get(
              snapshot.raw,
              "implement.claude",
              "enabled",
            ) as boolean,
          }
        : {}),
      tiers: {
        "claude-review": tier("review.claude", ["backend", "model", "effort"]),
        "codex-review": tier("review.codex", ["model", "effort"]),
        "codex-dispatch": tier("implement", ["model", "effort"]),
        "codex-default": tier("codex", ["default_model", "default_effort"]),
        "claude-implement": tier("implement.claude", [
          "backend",
          "model",
          "effort",
        ]),
      },
    },
  };
}

function validateCandidate(
  candidate: string,
  configPath: string,
): ReturnType<typeof parseConfigText> {
  try {
    return parseConfigText(candidate, configPath);
  } catch (err) {
    throw new Error(
      `candidate config failed validation before publish: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

const CLAUDE_IMPLEMENT_MIGRATION_KEYS = [
  "enabled",
  "backend",
  "model",
  "effort",
  "cli_path",
  "timeout_seconds",
  "max_output_bytes",
  "max_budget_usd",
  "supported_version_range",
  "allow_uncertified_version",
  "max_dispatches_per_design",
  "max_cumulative_wall_seconds",
  "max_cumulative_budget_usd",
  "max_daily_budget_usd",
  "validation_commands",
  "validation_definition_paths",
  "validation_additive_test_globs",
  "allow_advisory_apply",
] as const;

function migrationUpdates(): TomlUpdate[] {
  return [
    {
      section: "meta",
      key: "control_surface_schema",
      value: CONTROL_SURFACE_SCHEMA_V2,
    },
    ...CLAUDE_IMPLEMENT_MIGRATION_KEYS.map((key) => ({
      section: "implement.claude",
      key,
      value: CLAUDE_IMPLEMENT_DEFAULTS_V2[key],
    })),
  ];
}

interface MigrationProvenance {
  schema_version: 1;
  migration: "control-surface-schema-1-to-2";
  before_sha256: string;
  after_sha256: string;
  backup_sha256: string;
  backup_path: string;
}

function writeMigrationProvenance(
  repoRoot: string,
  written: {
    beforeSha256: string;
    afterSha256: string;
    backupPath: string;
  },
): string {
  const configBackupDir = join(repoRoot, ".ccsop", "backups", "config");
  mkdirSync(configBackupDir, { recursive: true, mode: 0o700 });
  const provenancePath = join(
    configBackupDir,
    `${written.beforeSha256}.provenance.json`,
  );
  const record: MigrationProvenance = {
    schema_version: 1,
    migration: "control-surface-schema-1-to-2",
    before_sha256: written.beforeSha256,
    after_sha256: written.afterSha256,
    backup_sha256: written.beforeSha256,
    backup_path: relative(repoRoot, written.backupPath).replaceAll("\\", "/"),
  };
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  if (existsSync(provenancePath)) {
    const stat = lstatSync(provenancePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`migration provenance is not a regular file: ${provenancePath}`);
    }
    if (readFileSync(provenancePath, "utf8") !== bytes) {
      throw new Error(`migration provenance collision: ${provenancePath}`);
    }
  } else {
    writeFileSync(provenancePath, bytes, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  return provenancePath;
}

function findRollbackProvenance(
  repoRoot: string,
  currentSha256: string,
): { path: string; record: MigrationProvenance } {
  const backupDir = join(repoRoot, ".ccsop", "backups", "config");
  if (!existsSync(backupDir)) {
    throw new Error("rollback refused: config migration backup directory is absent");
  }
  const matches: Array<{ path: string; record: MigrationProvenance }> = [];
  for (const name of readdirSync(backupDir).sort()) {
    if (!/^[a-f0-9]{64}\.provenance\.json$/.test(name)) continue;
    const path = join(backupDir, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`rollback refused: invalid provenance path ${path}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`rollback refused: corrupt provenance ${path}`);
    }
    const value = record(parsed);
    if (
      value.schema_version === 1 &&
      value.migration === "control-surface-schema-1-to-2" &&
      value.after_sha256 === currentSha256 &&
      typeof value.before_sha256 === "string" &&
      typeof value.backup_sha256 === "string" &&
      typeof value.backup_path === "string"
    ) {
      matches.push({ path, record: value as unknown as MigrationProvenance });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `rollback refused: expected one canonical provenance for current config, found ${matches.length}`,
    );
  }
  return matches[0]!;
}

function configRepoRoot(
  configPath: string,
  loaded: ReturnType<typeof parseConfigText>,
): string {
  return resolve(dirname(configPath), loaded.config.meta.repo_root);
}

export function handleCcsopConfigure(
  configPath: string,
  rawInput: unknown,
): CcsopConfigureResult {
  const input = ConfigureInput.parse(rawInput);
  const store = new RuntimeConfigStore(configPath);
  const snapshot = store.inspect();

  if (input.action === "status") {
    try {
      const loaded = parseConfigText(snapshot.text, configPath);
      return statusResult(input.action, {
        ...snapshot,
        config: loaded.config,
        loaded,
      });
    } catch (err) {
      return rawStatusResult(input.action, snapshot, err);
    }
  }
  requireExpectedSha(
    input.action,
    input.expected_config_sha256,
    snapshot.sha256,
  );

  if (input.action === "stamp-schema-v1") {
    if (snapshot.observedSchema === CONTROL_SURFACE_SCHEMA_V1) {
      const loaded = validateCandidate(snapshot.text, configPath);
      return statusResult(input.action, {
        ...snapshot,
        config: loaded.config,
        loaded,
      });
    }
    if (snapshot.observedSchema !== undefined) {
      throw new Error(
        `unsupported control_surface_schema=${snapshot.observedSchema}; expected absent or 1`,
      );
    }
    const updates: TomlUpdate[] = [
      {
        section: "meta",
        key: "control_surface_schema",
        value: CONTROL_SURFACE_SCHEMA_V1,
      },
    ];
    const candidate = applyTomlUpdates(snapshot.text, updates);
    const candidateLoaded = validateCandidate(candidate, configPath);
    const written = writeConfigAtomically(configPath, snapshot.text, candidate, {
      repoRoot: resolve(dirname(configPath), candidateLoaded.config.meta.repo_root),
    });
    const after = store.loadValidated();
    if (after.observedSchema !== CONTROL_SURFACE_SCHEMA_V1) {
      throw new Error("schema stamp verification failed");
    }
      return {
        ok: true,
        action: input.action,
        contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
      observed_schema: after.observedSchema,
      before_sha256: written.beforeSha256,
      after_sha256: written.afterSha256,
      changed_keys: ["meta.control_surface_schema"],
      backup_path: written.backupPath,
    };
  }

  if (input.action === "migrate-schema-v2") {
    if (snapshot.observedSchema === CONTROL_SURFACE_SCHEMA_V2) {
      const loaded = validateCandidate(snapshot.text, configPath);
      return statusResult(input.action, {
        ...snapshot,
        config: loaded.config,
        loaded,
      });
    }
    if (snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V1) {
      throw new Error(
        `control_surface_schema must be 1 before ${input.action}`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        record(record(snapshot.raw).implement).claude ?? {},
        "enabled",
      ) ||
      Object.prototype.hasOwnProperty.call(record(snapshot.raw), "implement") &&
        Object.prototype.hasOwnProperty.call(
          record(record(snapshot.raw).implement),
          "claude",
        )
    ) {
      throw new Error(
        "migration refused: [implement.claude] already exists; manual reconciliation required",
      );
    }
    const updates = migrationUpdates();
    const candidate = applyTomlUpdates(snapshot.text, updates);
    const candidateLoaded = validateCandidate(candidate, configPath);
    const repoRoot = configRepoRoot(configPath, candidateLoaded);
    const written = writeConfigAtomically(configPath, snapshot.text, candidate, {
      repoRoot,
    });
    let provenancePath: string;
    try {
      provenancePath = writeMigrationProvenance(repoRoot, written);
    } catch (err) {
      // Do not strand a schema=2 config without the rollback proof.
      writeConfigAtomically(configPath, candidate, snapshot.text, { repoRoot });
      throw err;
    }
    const after = store.loadValidated();
    if (after.observedSchema !== CONTROL_SURFACE_SCHEMA_V2) {
      throw new Error("schema migration verification failed");
    }
    return {
      ok: true,
      action: input.action,
      contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
      observed_schema: after.observedSchema,
      before_sha256: written.beforeSha256,
      after_sha256: written.afterSha256,
      changed_keys: updates.map((update) => `${update.section}.${update.key}`),
      backup_path: written.backupPath,
      migration_provenance_path: provenancePath,
    };
  }

  if (input.action === "rollback-schema-v1") {
    if (snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V2) {
      throw new Error(
        "control_surface_schema must be 2 before rollback-schema-v1",
      );
    }
    const loaded = validateCandidate(snapshot.text, configPath);
    if (loaded.config.implement.claude.enabled) {
      throw new Error(
        "rollback refused: disable implement.claude before rollback",
      );
    }
    const repoRoot = configRepoRoot(configPath, loaded);
    const provenance = findRollbackProvenance(repoRoot, snapshot.sha256);
    const backupPath = resolve(repoRoot, provenance.record.backup_path);
    const canonicalBackupDir = join(repoRoot, ".ccsop", "backups", "config");
    if (
      dirname(backupPath) !== canonicalBackupDir ||
      backupPath !==
        join(canonicalBackupDir, `${provenance.record.before_sha256}.toml`)
    ) {
      throw new Error("rollback refused: provenance backup path is non-canonical");
    }
    if (!existsSync(backupPath)) {
      throw new Error("rollback refused: migration backup is absent");
    }
    const stat = lstatSync(backupPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("rollback refused: backup must be a regular non-symlink file");
    }
    const backupText = readFileSync(backupPath, "utf8");
    if (
      sha256Text(backupText) !== provenance.record.before_sha256 ||
      provenance.record.backup_sha256 !== provenance.record.before_sha256
    ) {
      throw new Error("rollback refused: backup sha/provenance mismatch");
    }
    const rollbackLoaded = validateCandidate(backupText, configPath);
    if (
      rollbackLoaded.config.meta.control_surface_schema !==
        CONTROL_SURFACE_SCHEMA_V1 ||
      Object.prototype.hasOwnProperty.call(
        record(record(rollbackLoaded.raw).implement),
        "claude",
      )
    ) {
      throw new Error("rollback refused: backup is not canonical schema=1");
    }
    const written = writeConfigAtomically(
      configPath,
      snapshot.text,
      backupText,
      { repoRoot },
    );
    const after = store.loadValidated();
    if (after.observedSchema !== CONTROL_SURFACE_SCHEMA_V1) {
      throw new Error("schema rollback verification failed");
    }
    return {
      ok: true,
      action: input.action,
      contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
      observed_schema: after.observedSchema,
      before_sha256: written.beforeSha256,
      after_sha256: written.afterSha256,
      changed_keys: [
        "meta.control_surface_schema",
        "implement.claude",
      ],
      backup_path: written.backupPath,
      migration_provenance_path: provenance.path,
    };
  }

  if (
    snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V1 &&
    snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V2
  ) {
    throw new Error(
      `control_surface_schema must be 1 or 2 before ${input.action}; run /sop-update`,
    );
  }

  if (input.action === "disable-claude-implement") {
    if (snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V2) {
      throw new Error(
        "control_surface_schema must be 2 before disable-claude-implement",
      );
    }
    const updates = desiredUpdates(snapshot.raw, [
      {
        section: "implement.claude",
        key: "enabled",
        value: false,
      },
    ]);
    if (updates.length === 0) {
      const loaded = validateCandidate(snapshot.text, configPath);
      return {
        ...statusResult(input.action, {
          ...snapshot,
          config: loaded.config,
          loaded,
        }),
        safety_disable: true,
      };
    }
    const candidate = applyTomlUpdates(snapshot.text, updates);
    const candidateLoaded = validateCandidate(candidate, configPath);
    const written = writeConfigAtomically(configPath, snapshot.text, candidate, {
      repoRoot: configRepoRoot(configPath, candidateLoaded),
    });
    return {
      ok: true,
      action: input.action,
      contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
      observed_schema: CONTROL_SURFACE_SCHEMA_V2,
      before_sha256: written.beforeSha256,
      after_sha256: written.afterSha256,
      changed_keys: ["implement.claude.enabled"],
      backup_path: written.backupPath,
      safety_disable: true,
    };
  }

  let updates: TomlUpdate[];
  let selectedFlow: ControlSurfaceFlow | undefined;
  let safetyDisable = false;
  if (input.action === "set-flow") {
    selectedFlow = input.flow;
    const change = flowUpdates(
      snapshot.raw,
      input.flow,
      snapshot.observedSchema,
    );
    updates = change.updates;
    safetyDisable = change.safetyDisable;
  } else {
    if (
      input.scope === "claude-implement" &&
      snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V2
    ) {
      throw new Error(
        "claude-implement tier requires control_surface_schema=2 and the v2 bridge; run /sop-update and reconnect MCP",
      );
    }
    if (
      !PHASE2_TIER_SCOPES.includes(
        input.scope as (typeof PHASE2_TIER_SCOPES)[number],
      )
    ) {
      throw new Error(`unsupported tier scope: ${input.scope}`);
    }
    updates = tierUpdates(snapshot.raw, input, input.scope as Phase2TierScope);
  }

  if (updates.length === 0) {
    const loaded = validateCandidate(snapshot.text, configPath);
    return {
      ...statusResult(input.action, {
        ...snapshot,
        config: loaded.config,
        loaded,
      }),
      ...(selectedFlow ? { flow: selectedFlow } : {}),
      ...(selectedFlow === "codex+claude"
        ? {
            delivery:
              snapshot.observedSchema === CONTROL_SURFACE_SCHEMA_V2
                ? ("claude_implement proposal" as const)
                : ("manual relay" as const),
          }
        : {}),
      ...(safetyDisable ? { safety_disable: true } : {}),
    };
  }

  const candidate = applyTomlUpdates(snapshot.text, updates);
  const candidateLoaded = validateCandidate(candidate, configPath);
  const written = writeConfigAtomically(configPath, snapshot.text, candidate, {
    repoRoot: resolve(dirname(configPath), candidateLoaded.config.meta.repo_root),
  });
  const after = store.loadValidated();
  if (after.observedSchema !== snapshot.observedSchema) {
    throw new Error("post-write schema verification failed");
  }
  return {
    ok: true,
    action: input.action,
    contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V2,
    observed_schema: after.observedSchema,
    before_sha256: written.beforeSha256,
    after_sha256: written.afterSha256,
    changed_keys: updates.map((update) => `${update.section}.${update.key}`),
    backup_path: written.backupPath,
    ...(selectedFlow ? { flow: selectedFlow } : {}),
    ...(selectedFlow === "codex+claude"
      ? {
          delivery:
            snapshot.observedSchema === CONTROL_SURFACE_SCHEMA_V2
              ? ("claude_implement proposal" as const)
              : ("manual relay" as const),
        }
      : {}),
    ...(safetyDisable ? { safety_disable: true } : {}),
  };
}

export const ccsopConfigureToolName = "ccsop_configure";

export const ccsopConfigureToolSchema = {
  name: ccsopConfigureToolName,
  description:
    "Read or deterministically update the ccsop flow/tier control surface, including server-fixed schema v2 migration/rollback and fail-safe Claude implement disable. Mutations require an expected config sha.",
  inputSchema: {
    type: "object",
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: { action: { const: "status" } },
        required: ["action"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { const: "stamp-schema-v1" },
          expected_config_sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
        },
        required: ["action", "expected_config_sha256"],
      },
      ...[
        "migrate-schema-v2",
        "rollback-schema-v1",
      ].map((action) => ({
        type: "object",
        additionalProperties: false,
        properties: {
          action: { const: action },
          expected_config_sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
        },
        required: ["action", "expected_config_sha256"],
      })),
      {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { const: "disable-claude-implement" },
          expected_config_sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          enabled: { const: false },
        },
        required: ["action", "expected_config_sha256", "enabled"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { const: "set-flow" },
          expected_config_sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          flow: { type: "string", enum: [...FLOW_VALUES] },
        },
        required: ["action", "expected_config_sha256", "flow"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { const: "set-tier" },
          expected_config_sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          scope: { type: "string", enum: [...PHASE2_TIER_SCOPES] },
          model: { type: "string" },
          effort: { type: "string" },
          backend: { type: "string", enum: ["api", "cli"] },
          timeout_seconds: { type: "integer", minimum: 1 },
          max_output_bytes: { type: "integer", minimum: 1 },
          max_budget_usd: { type: "number", exclusiveMinimum: 0 },
          max_dispatches_per_design: { type: "integer", minimum: 1 },
          max_cumulative_wall_seconds: { type: "integer", minimum: 1 },
          max_cumulative_budget_usd: {
            type: "number",
            exclusiveMinimum: 0,
          },
          max_daily_budget_usd: {
            type: "number",
            exclusiveMinimum: 0,
          },
        },
        required: ["action", "expected_config_sha256", "scope"],
      },
    ],
  },
} as const;
