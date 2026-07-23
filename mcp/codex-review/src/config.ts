// Config loader: parse .codex-review/config.toml and validate against schema.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §7
//   §6.1.3 / §15.7 M4: minSafetyPolicy + 三阈值仅可收紧不可放宽

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import * as TOML from "@iarna/toml";
import { z } from "zod";
import { ProviderKindSchema } from "./types.js";

const PathsSchema = z.object({
  sop: z.string(),
  collaboration_sop: z.string(),
  handoff: z.string(),
  plans_active: z.string(),
  plans_completed: z.string(),
  sessions_dir: z.string(),
  backlog_dir: z.string(),
  archive_dir: z.string(),
});

const MetaSchema = z.object({
  project_id: z.string().min(1),
  project_name: z.string().min(1),
  language: z.string().default("en"),
  repo_root: z.string(),
  allowed_doc_roots: z.array(z.string()).min(1),
});

const StateSchema = z.object({
  lock_timeout_seconds: z.number().int().positive().default(30),
  session_retention_days: z.number().int().positive().default(90),
  backlog_retention_days: z.number().int().positive().default(180),
});

const CircuitBreakersSchema = z.object({
  max_design_review_rounds: z.number().int().positive().default(3),
  max_code_review_rounds: z.number().int().positive().default(3),
  max_fix_review_rounds: z.number().int().positive().default(3),
  scope_drift_lines_threshold: z.number().int().positive().default(400),
  context_warn_pct: z.number().min(0).max(1).default(0.6),
  context_force_new_thread_pct: z.number().min(0).max(1).default(0.8),
  codex_failure_streak_threshold: z.number().int().positive().default(3),
  parser_failure_streak_threshold: z.number().int().positive().default(3),
  // Round 3 verdict criteria thresholds (§3.0.1.B / §15.7 M4).
  // Server enforces "shrink-only" — see safety.ts.
  design_mechanical_max_sections: z.number().int().positive().default(8),
  code_mechanical_max_fix_lines: z.number().int().positive().default(100),
  code_mechanical_max_modules: z.number().int().positive().default(1),
});

const SafetySchema = z.object({
  // Project may add more dangerous verb regex; cannot relax MIN_SAFETY_POLICY (enforced in safety.ts).
  extra_danger_verbs_regex: z.string().default(""),
}).strict().partial({ extra_danger_verbs_regex: true }).transform((v) => ({
  extra_danger_verbs_regex: v.extra_danger_verbs_regex ?? "",
}));

const ReviewStageConfig = z.object({
  prompt_template: z.string().min(1),
  verdict_enum: z.array(z.string()).min(2),
  trigger_clauses: z.string().optional(),
  rule_sections: z.array(z.string()).optional(),
});

const CodexConfig = z.object({
  default_model: z.string().default(""),
}).default({ default_model: "" });

// ---------- Provider abstraction config (design §4.7, slice 2) ----------
// `[review] provider` selects the ReviewProvider; per-provider subtables tune each backend.
// `provider` defaults to "codex" so pre-abstraction configs (no [review.*] provider keys)
// validate unchanged and keep the verified codex path.

const CodexProviderConfig = z.object({
  // Model id for the codex turn; "" = SDK default. (Falls back to top-level [codex].default_model.)
  model: z.string().default(""),
  // Reserved: reasoning effort. @openai/codex-sdk@0.128.0 verified ThreadOptions does NOT expose
  // an effort field, so this is accepted but not yet applied to the SDK call (wiring deferred).
  effort: z.string().default(""),
}).default({ model: "", effort: "" });

const ClaudeProviderConfig = z.object({
  model: z.string().default(""),
  max_tokens: z.number().int().positive().default(16000),
  key_env: z.string().default("ANTHROPIC_API_KEY"),
  // Basis for the estimated context_usage_pct (input_tokens / context_window). Claude is
  // per-turn fresh so this is a single-turn estimate; the orchestrator's force_new_thread
  // threshold therefore rarely fires for claude (it is stateless — see design §4.7 / §12).
  context_window: z.number().int().positive().default(200000),
}).default({ model: "", max_tokens: 16000, key_env: "ANTHROPIC_API_KEY", context_window: 200000 });

const ManualProviderConfig = z.object({
  // "" = reuse paths.sessions_dir; otherwise an explicit dir for manual prompt/verdict files.
  sessions_dir: z.string().default(""),
}).default({ sessions_dir: "" });

// ---------- Flow matrix config (collaboration.md §1.D, design ccsop-flow-matrix) ----------
// The two owner keys are OPTIONAL WITH NO DEFAULT — presence is load-bearing
// (c_legacy_owner_presence): with BOTH absent the bridge stays in legacy mode and
// `review.provider` governs every stage; with any present, per-stage reviewer derivation is
// active (see providers/factory.ts providerKindForStage). An invalid value is a schema error
// (server starts degraded) — never a silent fallback to a default owner.
const OwnerSchema = z.enum(["claude", "codex"]);
const CollaborationSchema = z.object({
  // Operational autonomy dial (collaboration.md §1.A) — accepted here so consumer configs
  // validate; the bridge itself ignores it.
  autonomy: z.string().optional(),
  design_owner: OwnerSchema.optional(),
  implement_owner: OwnerSchema.optional(),
}).default({});

// ---------- codex_implement config (design ccsop-codex-implement, proposal mode v3) ----------
// Ships DISABLED. /sop-init enables it only for the exact preside flow
// design_owner=claude ∧ implement_owner=codex. Thresholds are shrink-only vs the
// IMPLEMENT_MIN_POLICY defaults (enforced in safety.ts — config may tighten, never widen).
const ImplementConfig = z.object({
  enabled: z.boolean().default(false),
  max_implement_rounds: z.number().int().positive().default(3),
  // v1 text-only patch contract (design §4.2.D): per-file byte cap applied to BOTH delta sides.
  max_file_bytes: z.number().int().positive().default(2 * 1024 * 1024),
}).default({});

export const ConfigSchema = z.object({
  meta: MetaSchema,
  paths: PathsSchema,
  state: StateSchema.default({} as Record<string, never>),
  circuit_breakers: CircuitBreakersSchema.default({} as Record<string, never>),
  safety: SafetySchema.default({ extra_danger_verbs_regex: "" }),
  collaboration: CollaborationSchema,
  implement: ImplementConfig,
  review: z.object({
    provider: ProviderKindSchema.default("codex"),
    design: ReviewStageConfig,
    code: ReviewStageConfig,
    fix: ReviewStageConfig,
    codex: CodexProviderConfig,
    claude: ClaudeProviderConfig,
    manual: ManualProviderConfig,
  }),
  codex: CodexConfig,
});
export type ResolvedConfig = z.infer<typeof ConfigSchema>;

export interface LoadConfigOptions {
  configPath: string;
  /** Absolute path used to resolve all relative entries. Defaults to dirname(configPath). */
  baseDir?: string;
}

export interface LoadedConfig {
  raw: unknown;
  config: ResolvedConfig;
  configPath: string;
}

export function loadConfig(opts: LoadConfigOptions): LoadedConfig {
  const text = readFileSync(opts.configPath, "utf8");
  const parsed = TOML.parse(text);
  const validated = ConfigSchema.parse(parsed);
  return {
    raw: parsed,
    config: validated,
    configPath: opts.configPath,
  };
}

/**
 * Resolve a config-relative path against the project root (config.meta.repo_root).
 * If `repo_root` is itself relative, it is resolved against `baseDir`
 * (defaults to the config file's directory).
 */
export function resolveProjectPath(
  config: ResolvedConfig,
  baseDir: string,
  relativePath: string,
): string {
  const projectRoot = resolvePath(baseDir, config.meta.repo_root);
  return resolvePath(projectRoot, relativePath);
}
