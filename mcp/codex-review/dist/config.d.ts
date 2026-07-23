import { z } from "zod";
export declare const EffortSchema: z.ZodEnum<["", "minimal", "low", "medium", "high", "xhigh"]>;
/** Non-empty effort union — exactly the SDK's ThreadOptions.modelReasoningEffort domain. */
export type CodexEffort = Exclude<z.infer<typeof EffortSchema>, "">;
export declare const ConfigSchema: z.ZodObject<{
    meta: z.ZodObject<{
        project_id: z.ZodString;
        project_name: z.ZodString;
        language: z.ZodDefault<z.ZodString>;
        repo_root: z.ZodString;
        allowed_doc_roots: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        project_id: string;
        project_name: string;
        language: string;
        repo_root: string;
        allowed_doc_roots: string[];
    }, {
        project_id: string;
        project_name: string;
        repo_root: string;
        allowed_doc_roots: string[];
        language?: string | undefined;
    }>;
    paths: z.ZodObject<{
        sop: z.ZodString;
        collaboration_sop: z.ZodString;
        handoff: z.ZodString;
        plans_active: z.ZodString;
        plans_completed: z.ZodString;
        sessions_dir: z.ZodString;
        backlog_dir: z.ZodString;
        archive_dir: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sop: string;
        collaboration_sop: string;
        handoff: string;
        plans_active: string;
        plans_completed: string;
        sessions_dir: string;
        backlog_dir: string;
        archive_dir: string;
    }, {
        sop: string;
        collaboration_sop: string;
        handoff: string;
        plans_active: string;
        plans_completed: string;
        sessions_dir: string;
        backlog_dir: string;
        archive_dir: string;
    }>;
    state: z.ZodDefault<z.ZodObject<{
        lock_timeout_seconds: z.ZodDefault<z.ZodNumber>;
        session_retention_days: z.ZodDefault<z.ZodNumber>;
        backlog_retention_days: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        lock_timeout_seconds: number;
        session_retention_days: number;
        backlog_retention_days: number;
    }, {
        lock_timeout_seconds?: number | undefined;
        session_retention_days?: number | undefined;
        backlog_retention_days?: number | undefined;
    }>>;
    circuit_breakers: z.ZodDefault<z.ZodObject<{
        max_design_review_rounds: z.ZodDefault<z.ZodNumber>;
        max_code_review_rounds: z.ZodDefault<z.ZodNumber>;
        max_fix_review_rounds: z.ZodDefault<z.ZodNumber>;
        scope_drift_lines_threshold: z.ZodDefault<z.ZodNumber>;
        context_warn_pct: z.ZodDefault<z.ZodNumber>;
        context_force_new_thread_pct: z.ZodDefault<z.ZodNumber>;
        codex_failure_streak_threshold: z.ZodDefault<z.ZodNumber>;
        parser_failure_streak_threshold: z.ZodDefault<z.ZodNumber>;
        design_mechanical_max_sections: z.ZodDefault<z.ZodNumber>;
        code_mechanical_max_fix_lines: z.ZodDefault<z.ZodNumber>;
        code_mechanical_max_modules: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        context_force_new_thread_pct: number;
        max_design_review_rounds: number;
        max_code_review_rounds: number;
        max_fix_review_rounds: number;
        scope_drift_lines_threshold: number;
        context_warn_pct: number;
        codex_failure_streak_threshold: number;
        parser_failure_streak_threshold: number;
        design_mechanical_max_sections: number;
        code_mechanical_max_fix_lines: number;
        code_mechanical_max_modules: number;
    }, {
        context_force_new_thread_pct?: number | undefined;
        max_design_review_rounds?: number | undefined;
        max_code_review_rounds?: number | undefined;
        max_fix_review_rounds?: number | undefined;
        scope_drift_lines_threshold?: number | undefined;
        context_warn_pct?: number | undefined;
        codex_failure_streak_threshold?: number | undefined;
        parser_failure_streak_threshold?: number | undefined;
        design_mechanical_max_sections?: number | undefined;
        code_mechanical_max_fix_lines?: number | undefined;
        code_mechanical_max_modules?: number | undefined;
    }>>;
    safety: z.ZodDefault<z.ZodEffects<z.ZodObject<{
        extra_danger_verbs_regex: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    }, "strict", z.ZodTypeAny, {
        extra_danger_verbs_regex?: string | undefined;
    }, {
        extra_danger_verbs_regex?: string | undefined;
    }>, {
        extra_danger_verbs_regex: string;
    }, {
        extra_danger_verbs_regex?: string | undefined;
    }>>;
    collaboration: z.ZodDefault<z.ZodObject<{
        autonomy: z.ZodOptional<z.ZodString>;
        design_owner: z.ZodOptional<z.ZodEnum<["claude", "codex"]>>;
        implement_owner: z.ZodOptional<z.ZodEnum<["claude", "codex"]>>;
    }, "strip", z.ZodTypeAny, {
        autonomy?: string | undefined;
        design_owner?: "codex" | "claude" | undefined;
        implement_owner?: "codex" | "claude" | undefined;
    }, {
        autonomy?: string | undefined;
        design_owner?: "codex" | "claude" | undefined;
        implement_owner?: "codex" | "claude" | undefined;
    }>>;
    implement: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        model: z.ZodDefault<z.ZodString>;
        effort: z.ZodDefault<z.ZodEnum<["", "minimal", "low", "medium", "high", "xhigh"]>>;
        max_implement_rounds: z.ZodDefault<z.ZodNumber>;
        max_file_bytes: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
        enabled: boolean;
        max_implement_rounds: number;
        max_file_bytes: number;
    }, {
        model?: string | undefined;
        effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        enabled?: boolean | undefined;
        max_implement_rounds?: number | undefined;
        max_file_bytes?: number | undefined;
    }>>;
    review: z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["codex", "claude", "manual"]>>;
        design: z.ZodObject<{
            prompt_template: z.ZodString;
            verdict_enum: z.ZodArray<z.ZodString, "many">;
            trigger_clauses: z.ZodOptional<z.ZodString>;
            rule_sections: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        }, {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        }>;
        code: z.ZodObject<{
            prompt_template: z.ZodString;
            verdict_enum: z.ZodArray<z.ZodString, "many">;
            trigger_clauses: z.ZodOptional<z.ZodString>;
            rule_sections: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        }, {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        }>;
        fix: z.ZodObject<{
            prompt_template: z.ZodString;
            verdict_enum: z.ZodArray<z.ZodString, "many">;
            trigger_clauses: z.ZodOptional<z.ZodString>;
            rule_sections: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        }, {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        }>;
        codex: z.ZodDefault<z.ZodObject<{
            model: z.ZodDefault<z.ZodString>;
            effort: z.ZodDefault<z.ZodEnum<["", "minimal", "low", "medium", "high", "xhigh"]>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
        }, {
            model?: string | undefined;
            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        }>>;
        claude: z.ZodDefault<z.ZodObject<{
            model: z.ZodDefault<z.ZodString>;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            key_env: z.ZodDefault<z.ZodString>;
            context_window: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            max_tokens: number;
            key_env: string;
            context_window: number;
        }, {
            model?: string | undefined;
            max_tokens?: number | undefined;
            key_env?: string | undefined;
            context_window?: number | undefined;
        }>>;
        manual: z.ZodDefault<z.ZodObject<{
            sessions_dir: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            sessions_dir: string;
        }, {
            sessions_dir?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        design: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        code: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        fix: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        codex: {
            model: string;
            effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
        };
        claude: {
            model: string;
            max_tokens: number;
            key_env: string;
            context_window: number;
        };
        manual: {
            sessions_dir: string;
        };
        provider: "codex" | "claude" | "manual";
    }, {
        design: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        code: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        fix: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        codex?: {
            model?: string | undefined;
            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        } | undefined;
        claude?: {
            model?: string | undefined;
            max_tokens?: number | undefined;
            key_env?: string | undefined;
            context_window?: number | undefined;
        } | undefined;
        manual?: {
            sessions_dir?: string | undefined;
        } | undefined;
        provider?: "codex" | "claude" | "manual" | undefined;
    }>;
    codex: z.ZodDefault<z.ZodObject<{
        default_model: z.ZodDefault<z.ZodString>;
        default_effort: z.ZodDefault<z.ZodEnum<["", "minimal", "low", "medium", "high", "xhigh"]>>;
    }, "strip", z.ZodTypeAny, {
        default_model: string;
        default_effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
    }, {
        default_model?: string | undefined;
        default_effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    codex: {
        default_model: string;
        default_effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
    };
    meta: {
        project_id: string;
        project_name: string;
        language: string;
        repo_root: string;
        allowed_doc_roots: string[];
    };
    paths: {
        sop: string;
        collaboration_sop: string;
        handoff: string;
        plans_active: string;
        plans_completed: string;
        sessions_dir: string;
        backlog_dir: string;
        archive_dir: string;
    };
    state: {
        lock_timeout_seconds: number;
        session_retention_days: number;
        backlog_retention_days: number;
    };
    circuit_breakers: {
        context_force_new_thread_pct: number;
        max_design_review_rounds: number;
        max_code_review_rounds: number;
        max_fix_review_rounds: number;
        scope_drift_lines_threshold: number;
        context_warn_pct: number;
        codex_failure_streak_threshold: number;
        parser_failure_streak_threshold: number;
        design_mechanical_max_sections: number;
        code_mechanical_max_fix_lines: number;
        code_mechanical_max_modules: number;
    };
    safety: {
        extra_danger_verbs_regex: string;
    };
    collaboration: {
        autonomy?: string | undefined;
        design_owner?: "codex" | "claude" | undefined;
        implement_owner?: "codex" | "claude" | undefined;
    };
    implement: {
        model: string;
        effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
        enabled: boolean;
        max_implement_rounds: number;
        max_file_bytes: number;
    };
    review: {
        design: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        code: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        fix: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        codex: {
            model: string;
            effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
        };
        claude: {
            model: string;
            max_tokens: number;
            key_env: string;
            context_window: number;
        };
        manual: {
            sessions_dir: string;
        };
        provider: "codex" | "claude" | "manual";
    };
}, {
    meta: {
        project_id: string;
        project_name: string;
        repo_root: string;
        allowed_doc_roots: string[];
        language?: string | undefined;
    };
    paths: {
        sop: string;
        collaboration_sop: string;
        handoff: string;
        plans_active: string;
        plans_completed: string;
        sessions_dir: string;
        backlog_dir: string;
        archive_dir: string;
    };
    review: {
        design: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        code: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        fix: {
            prompt_template: string;
            verdict_enum: string[];
            trigger_clauses?: string | undefined;
            rule_sections?: string[] | undefined;
        };
        codex?: {
            model?: string | undefined;
            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        } | undefined;
        claude?: {
            model?: string | undefined;
            max_tokens?: number | undefined;
            key_env?: string | undefined;
            context_window?: number | undefined;
        } | undefined;
        manual?: {
            sessions_dir?: string | undefined;
        } | undefined;
        provider?: "codex" | "claude" | "manual" | undefined;
    };
    codex?: {
        default_model?: string | undefined;
        default_effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
    } | undefined;
    state?: {
        lock_timeout_seconds?: number | undefined;
        session_retention_days?: number | undefined;
        backlog_retention_days?: number | undefined;
    } | undefined;
    circuit_breakers?: {
        context_force_new_thread_pct?: number | undefined;
        max_design_review_rounds?: number | undefined;
        max_code_review_rounds?: number | undefined;
        max_fix_review_rounds?: number | undefined;
        scope_drift_lines_threshold?: number | undefined;
        context_warn_pct?: number | undefined;
        codex_failure_streak_threshold?: number | undefined;
        parser_failure_streak_threshold?: number | undefined;
        design_mechanical_max_sections?: number | undefined;
        code_mechanical_max_fix_lines?: number | undefined;
        code_mechanical_max_modules?: number | undefined;
    } | undefined;
    safety?: {
        extra_danger_verbs_regex?: string | undefined;
    } | undefined;
    collaboration?: {
        autonomy?: string | undefined;
        design_owner?: "codex" | "claude" | undefined;
        implement_owner?: "codex" | "claude" | undefined;
    } | undefined;
    implement?: {
        model?: string | undefined;
        effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        enabled?: boolean | undefined;
        max_implement_rounds?: number | undefined;
        max_file_bytes?: number | undefined;
    } | undefined;
}>;
export type ResolvedConfig = z.infer<typeof ConfigSchema>;
/** Single authority for the per-class codex tier chains (model-effort design §3):
 * review:    review.codex.model/effort → codex.default_model/default_effort → SDK default
 * implement: implement.model/effort    → codex.default_model/default_effort → SDK default
 * The implement writer never inherits review.codex.model (borrow removed, regression-pinned). */
export declare function resolveCodexTier(config: ResolvedConfig, scope: "review" | "implement"): {
    model: string | undefined;
    effort: CodexEffort | undefined;
};
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
export declare function loadConfig(opts: LoadConfigOptions): LoadedConfig;
/**
 * Resolve a config-relative path against the project root (config.meta.repo_root).
 * If `repo_root` is itself relative, it is resolved against `baseDir`
 * (defaults to the config file's directory).
 */
export declare function resolveProjectPath(config: ResolvedConfig, baseDir: string, relativePath: string): string;
//# sourceMappingURL=config.d.ts.map