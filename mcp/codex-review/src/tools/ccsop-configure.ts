import { z } from "zod";
import { dirname, resolve } from "node:path";

import {
  CLAUDE_EFFORT_VALUES,
  CODEX_EFFORT_VALUES,
  CONTROL_SURFACE_CONTRACT_VERSION_V1,
  CONTROL_SURFACE_SCHEMA_V1,
  FLOW_VALUES,
  PHASE1_TIER_SCOPES,
  type ControlSurfaceFlow,
  type Phase1TierScope,
} from "../control-surface-contract.js";
import { parseConfigText } from "../config.js";
import {
  applyTomlUpdates,
  writeConfigAtomically,
  type TomlUpdate,
} from "../config-writer.js";
import { RuntimeConfigStore } from "../runtime-config-store.js";
import type {
  ConfigInspection,
  ValidatedConfigSnapshot,
} from "../runtime-config-store.js";

const ExpectedSha = z.string().regex(/^[a-f0-9]{64}$/);
const ConfigureInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z
    .object({
      action: z.literal("stamp-schema-v1"),
      expected_config_sha256: ExpectedSha,
    })
    .strict(),
  z
    .object({
      action: z.literal("set-flow"),
      expected_config_sha256: ExpectedSha,
      flow: z.enum(FLOW_VALUES),
    })
    .strict(),
  z
    .object({
      action: z.literal("set-tier"),
      expected_config_sha256: ExpectedSha,
      scope: z.string(),
      model: z.string().optional(),
      effort: z.string().optional(),
      backend: z.enum(["api", "cli"]).optional(),
    })
    .strict(),
]);
type ConfigureInputValue = z.infer<typeof ConfigureInput>;
type SetTierInput = Extract<ConfigureInputValue, { action: "set-tier" }>;

export interface CcsopConfigureResult {
  ok: true;
  action: z.infer<typeof ConfigureInput>["action"];
  contract_version: 1;
  observed_schema: number | null;
  before_sha256: string;
  after_sha256: string;
  changed_keys: string[];
  backup_path?: string;
  flow?: ControlSurfaceFlow;
  delivery?: "manual relay";
  status?: {
    config_valid: boolean;
    validation_error?: string;
    flow_mode: "legacy" | "explicit" | "invalid";
    resolved_flow?: ControlSurfaceFlow;
    design_owner?: string;
    implement_owner?: string;
    review_provider?: string;
    codex_implement_enabled?: boolean;
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

function flowUpdates(raw: unknown, flow: ControlSurfaceFlow): TomlUpdate[] {
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
  return desiredUpdates(raw, candidates);
}

function tierUpdates(
  raw: unknown,
  input: SetTierInput,
  scope: Phase1TierScope,
): TomlUpdate[] {
  if (input.model === undefined && input.effort === undefined && input.backend === undefined) {
    throw new Error("set-tier requires at least one of model, effort, or backend");
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
    contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V1,
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
    contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V1,
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
      tiers: {
        "claude-review": tier("review.claude", ["backend", "model", "effort"]),
        "codex-review": tier("review.codex", ["model", "effort"]),
        "codex-dispatch": tier("implement", ["model", "effort"]),
        "codex-default": tier("codex", ["default_model", "default_effort"]),
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
      contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V1,
      observed_schema: after.observedSchema,
      before_sha256: written.beforeSha256,
      after_sha256: written.afterSha256,
      changed_keys: ["meta.control_surface_schema"],
      backup_path: written.backupPath,
    };
  }

  if (snapshot.observedSchema !== CONTROL_SURFACE_SCHEMA_V1) {
    throw new Error(
      `control_surface_schema must be 1 before ${input.action}; run /sop-update`,
    );
  }

  let updates: TomlUpdate[];
  let selectedFlow: ControlSurfaceFlow | undefined;
  if (input.action === "set-flow") {
    selectedFlow = input.flow;
    updates = flowUpdates(snapshot.raw, input.flow);
  } else {
    if (
      !PHASE1_TIER_SCOPES.includes(
        input.scope as (typeof PHASE1_TIER_SCOPES)[number],
      )
    ) {
      throw new Error(`unsupported Phase 1 tier scope: ${input.scope}`);
    }
    updates = tierUpdates(snapshot.raw, input, input.scope as Phase1TierScope);
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
        ? { delivery: "manual relay" as const }
        : {}),
    };
  }

  const candidate = applyTomlUpdates(snapshot.text, updates);
  const candidateLoaded = validateCandidate(candidate, configPath);
  const written = writeConfigAtomically(configPath, snapshot.text, candidate, {
    repoRoot: resolve(dirname(configPath), candidateLoaded.config.meta.repo_root),
  });
  const after = store.loadValidated();
  if (after.observedSchema !== CONTROL_SURFACE_SCHEMA_V1) {
    throw new Error("post-write schema verification failed");
  }
  return {
    ok: true,
    action: input.action,
    contract_version: CONTROL_SURFACE_CONTRACT_VERSION_V1,
    observed_schema: after.observedSchema,
    before_sha256: written.beforeSha256,
    after_sha256: written.afterSha256,
    changed_keys: updates.map((update) => `${update.section}.${update.key}`),
    backup_path: written.backupPath,
    ...(selectedFlow ? { flow: selectedFlow } : {}),
    ...(selectedFlow === "codex+claude"
      ? { delivery: "manual relay" as const }
      : {}),
  };
}

export const ccsopConfigureToolName = "ccsop_configure";

export const ccsopConfigureToolSchema = {
  name: ccsopConfigureToolName,
  description:
    "Read or deterministically update the ccsop Phase 1 flow/tier control surface. Mutations require an expected config sha and preserve unrelated TOML bytes.",
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
          scope: { type: "string", enum: [...PHASE1_TIER_SCOPES] },
          model: { type: "string" },
          effort: { type: "string" },
          backend: { type: "string", enum: ["api", "cli"] },
        },
        required: ["action", "expected_config_sha256", "scope"],
      },
    ],
  },
} as const;
