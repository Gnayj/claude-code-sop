import { z } from "zod";
export declare const ReviewStage: z.ZodEnum<["design", "code", "fix"]>;
export type ReviewStage = z.infer<typeof ReviewStage>;
export declare const ProviderKindSchema: z.ZodEnum<["codex", "claude", "manual"]>;
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
export declare const DesignVerdict: z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>;
export type DesignVerdict = z.infer<typeof DesignVerdict>;
export declare const CodeVerdict: z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>;
export type CodeVerdict = z.infer<typeof CodeVerdict>;
export declare const FixVerdict: z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>;
export type FixVerdict = z.infer<typeof FixVerdict>;
export declare const AnyVerdict: z.ZodUnion<[z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>]>;
export type AnyVerdict = z.infer<typeof AnyVerdict>;
export declare const REJECTED_OLD_VERDICTS: Set<string>;
export declare const VerdictFactors: z.ZodObject<{
    critical_count: z.ZodNumber;
    important_count: z.ZodNumber;
    affected_major_sections_count: z.ZodNumber;
    has_open_design_decision: z.ZodBoolean;
    has_new_arch_concept: z.ZodBoolean;
    has_interdependent_rc: z.ZodBoolean;
    estimated_fix_lines: z.ZodNumber;
    touched_module_count: z.ZodNumber;
    has_design_gap: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    critical_count: number;
    important_count: number;
    affected_major_sections_count: number;
    has_open_design_decision: boolean;
    has_new_arch_concept: boolean;
    has_interdependent_rc: boolean;
    estimated_fix_lines: number;
    touched_module_count: number;
    has_design_gap: boolean;
}, {
    critical_count: number;
    important_count: number;
    affected_major_sections_count: number;
    has_open_design_decision: boolean;
    has_new_arch_concept: boolean;
    has_interdependent_rc: boolean;
    estimated_fix_lines: number;
    touched_module_count: number;
    has_design_gap: boolean;
}>;
export type VerdictFactors = z.infer<typeof VerdictFactors>;
export declare const VERDICT_FACTOR_KEYS: ReadonlyArray<keyof VerdictFactors>;
export declare const TargetFileLine: z.ZodObject<{
    kind: z.ZodLiteral<"file_line">;
    file: z.ZodString;
    line: z.ZodNullable<z.ZodNumber>;
    missing_artifact_kind: z.ZodOptional<z.ZodNull>;
    missing_artifact_path: z.ZodOptional<z.ZodNull>;
}, "strip", z.ZodTypeAny, {
    kind: "file_line";
    file: string;
    line: number | null;
    missing_artifact_kind?: null | undefined;
    missing_artifact_path?: null | undefined;
}, {
    kind: "file_line";
    file: string;
    line: number | null;
    missing_artifact_kind?: null | undefined;
    missing_artifact_path?: null | undefined;
}>;
export declare const MissingArtifactKind: z.ZodEnum<["test", "config", "doc", "module"]>;
export type MissingArtifactKind = z.infer<typeof MissingArtifactKind>;
export declare const TargetMissingArtifact: z.ZodObject<{
    kind: z.ZodLiteral<"missing_artifact">;
    file: z.ZodOptional<z.ZodNull>;
    line: z.ZodOptional<z.ZodNull>;
    missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
    missing_artifact_path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    kind: "missing_artifact";
    missing_artifact_kind: "test" | "config" | "doc" | "module";
    missing_artifact_path: string;
    file?: null | undefined;
    line?: null | undefined;
}, {
    kind: "missing_artifact";
    missing_artifact_kind: "test" | "config" | "doc" | "module";
    missing_artifact_path: string;
    file?: null | undefined;
    line?: null | undefined;
}>;
export declare const ConclusionTarget: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"file_line">;
    file: z.ZodString;
    line: z.ZodNullable<z.ZodNumber>;
    missing_artifact_kind: z.ZodOptional<z.ZodNull>;
    missing_artifact_path: z.ZodOptional<z.ZodNull>;
}, "strip", z.ZodTypeAny, {
    kind: "file_line";
    file: string;
    line: number | null;
    missing_artifact_kind?: null | undefined;
    missing_artifact_path?: null | undefined;
}, {
    kind: "file_line";
    file: string;
    line: number | null;
    missing_artifact_kind?: null | undefined;
    missing_artifact_path?: null | undefined;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"missing_artifact">;
    file: z.ZodOptional<z.ZodNull>;
    line: z.ZodOptional<z.ZodNull>;
    missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
    missing_artifact_path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    kind: "missing_artifact";
    missing_artifact_kind: "test" | "config" | "doc" | "module";
    missing_artifact_path: string;
    file?: null | undefined;
    line?: null | undefined;
}, {
    kind: "missing_artifact";
    missing_artifact_kind: "test" | "config" | "doc" | "module";
    missing_artifact_path: string;
    file?: null | undefined;
    line?: null | undefined;
}>]>;
export type ConclusionTarget = z.infer<typeof ConclusionTarget>;
export declare const ConclusionLevel: z.ZodEnum<["Critical", "Important", "Suggestion"]>;
export type ConclusionLevel = z.infer<typeof ConclusionLevel>;
export declare const AutoFixClass: z.ZodEnum<["auto", "manual-only", "deferred-to-next-round", "rejected-by-parser"]>;
export type AutoFixClass = z.infer<typeof AutoFixClass>;
export declare const Conclusion: z.ZodObject<{
    conclusion_id: z.ZodString;
    level: z.ZodEnum<["Critical", "Important", "Suggestion"]>;
    rule: z.ZodNullable<z.ZodString>;
    target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"file_line">;
        file: z.ZodString;
        line: z.ZodNullable<z.ZodNumber>;
        missing_artifact_kind: z.ZodOptional<z.ZodNull>;
        missing_artifact_path: z.ZodOptional<z.ZodNull>;
    }, "strip", z.ZodTypeAny, {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    }, {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"missing_artifact">;
        file: z.ZodOptional<z.ZodNull>;
        line: z.ZodOptional<z.ZodNull>;
        missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
        missing_artifact_path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    }, {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    }>]>;
    evidence: z.ZodString;
    fix: z.ZodString;
    auto_fix_class: z.ZodEnum<["auto", "manual-only", "deferred-to-next-round", "rejected-by-parser"]>;
}, "strip", z.ZodTypeAny, {
    fix: string;
    conclusion_id: string;
    level: "Critical" | "Important" | "Suggestion";
    rule: string | null;
    target: {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    } | {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    };
    evidence: string;
    auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
}, {
    fix: string;
    conclusion_id: string;
    level: "Critical" | "Important" | "Suggestion";
    rule: string | null;
    target: {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    } | {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    };
    evidence: string;
    auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
}>;
export type Conclusion = z.infer<typeof Conclusion>;
export declare const NextAction: z.ZodEnum<["fix-required", "ready-to-implement", "ready-to-test", "blocked"]>;
export type NextAction = z.infer<typeof NextAction>;
export declare const RejectedReason: z.ZodEnum<["tool_violation", "scope_violation", "schema_violation"]>;
export type RejectedReason = z.infer<typeof RejectedReason>;
export declare const RejectedItem: z.ZodObject<{
    reason: z.ZodEnum<["tool_violation", "scope_violation", "schema_violation"]>;
    raw_excerpt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: "tool_violation" | "scope_violation" | "schema_violation";
    raw_excerpt: string;
}, {
    reason: "tool_violation" | "scope_violation" | "schema_violation";
    raw_excerpt: string;
}>;
export type RejectedItem = z.infer<typeof RejectedItem>;
export declare const ContextUsagePct: z.ZodEffects<z.ZodNumber, number, unknown>;
export declare const ReviewEnvelope: z.ZodObject<{
    thread_id: z.ZodString;
    review_id: z.ZodString;
    design_id: z.ZodString;
    stage: z.ZodEnum<["design", "code", "fix"]>;
    review_round: z.ZodNumber;
    verdict: z.ZodUnion<[z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>]>;
    verdict_factors: z.ZodObject<{
        critical_count: z.ZodNumber;
        important_count: z.ZodNumber;
        affected_major_sections_count: z.ZodNumber;
        has_open_design_decision: z.ZodBoolean;
        has_new_arch_concept: z.ZodBoolean;
        has_interdependent_rc: z.ZodBoolean;
        estimated_fix_lines: z.ZodNumber;
        touched_module_count: z.ZodNumber;
        has_design_gap: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    }, {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    }>;
    conclusions: z.ZodArray<z.ZodObject<{
        conclusion_id: z.ZodString;
        level: z.ZodEnum<["Critical", "Important", "Suggestion"]>;
        rule: z.ZodNullable<z.ZodString>;
        target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"file_line">;
            file: z.ZodString;
            line: z.ZodNullable<z.ZodNumber>;
            missing_artifact_kind: z.ZodOptional<z.ZodNull>;
            missing_artifact_path: z.ZodOptional<z.ZodNull>;
        }, "strip", z.ZodTypeAny, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"missing_artifact">;
            file: z.ZodOptional<z.ZodNull>;
            line: z.ZodOptional<z.ZodNull>;
            missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
            missing_artifact_path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }>]>;
        evidence: z.ZodString;
        fix: z.ZodString;
        auto_fix_class: z.ZodEnum<["auto", "manual-only", "deferred-to-next-round", "rejected-by-parser"]>;
    }, "strip", z.ZodTypeAny, {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }, {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }>, "many">;
    open_questions: z.ZodArray<z.ZodString, "many">;
    tokens_used_estimate: z.ZodNumber;
    context_usage_pct: z.ZodEffects<z.ZodNumber, number, unknown>;
    compact_summary_for_round: z.ZodString;
    next_action: z.ZodEnum<["fix-required", "ready-to-implement", "ready-to-test", "blocked"]>;
    rejected_by_parser: z.ZodArray<z.ZodObject<{
        reason: z.ZodEnum<["tool_violation", "scope_violation", "schema_violation"]>;
        raw_excerpt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }, {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    thread_id: string;
    review_id: string;
    design_id: string;
    stage: "design" | "code" | "fix";
    review_round: number;
    verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
    verdict_factors: {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    };
    conclusions: {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }[];
    open_questions: string[];
    tokens_used_estimate: number;
    context_usage_pct: number;
    compact_summary_for_round: string;
    next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
    rejected_by_parser: {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }[];
}, {
    thread_id: string;
    review_id: string;
    design_id: string;
    stage: "design" | "code" | "fix";
    review_round: number;
    verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
    verdict_factors: {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    };
    conclusions: {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }[];
    open_questions: string[];
    tokens_used_estimate: number;
    compact_summary_for_round: string;
    next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
    rejected_by_parser: {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }[];
    context_usage_pct?: unknown;
}>;
export type ReviewEnvelope = z.infer<typeof ReviewEnvelope>;
export declare const SERVER_OVERRIDE_PLACEHOLDER = "pending-server-override";
export declare const CodexEmittedEnvelope: z.ZodObject<{
    design_id: z.ZodString;
    stage: z.ZodEnum<["design", "code", "fix"]>;
    review_round: z.ZodNumber;
    verdict: z.ZodUnion<[z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>]>;
    verdict_factors: z.ZodObject<{
        critical_count: z.ZodNumber;
        important_count: z.ZodNumber;
        affected_major_sections_count: z.ZodNumber;
        has_open_design_decision: z.ZodBoolean;
        has_new_arch_concept: z.ZodBoolean;
        has_interdependent_rc: z.ZodBoolean;
        estimated_fix_lines: z.ZodNumber;
        touched_module_count: z.ZodNumber;
        has_design_gap: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    }, {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    }>;
    conclusions: z.ZodArray<z.ZodObject<{
        conclusion_id: z.ZodString;
        level: z.ZodEnum<["Critical", "Important", "Suggestion"]>;
        rule: z.ZodNullable<z.ZodString>;
        target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"file_line">;
            file: z.ZodString;
            line: z.ZodNullable<z.ZodNumber>;
            missing_artifact_kind: z.ZodOptional<z.ZodNull>;
            missing_artifact_path: z.ZodOptional<z.ZodNull>;
        }, "strip", z.ZodTypeAny, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"missing_artifact">;
            file: z.ZodOptional<z.ZodNull>;
            line: z.ZodOptional<z.ZodNull>;
            missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
            missing_artifact_path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }>]>;
        evidence: z.ZodString;
        fix: z.ZodString;
        auto_fix_class: z.ZodEnum<["auto", "manual-only", "deferred-to-next-round", "rejected-by-parser"]>;
    }, "strip", z.ZodTypeAny, {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }, {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }>, "many">;
    open_questions: z.ZodArray<z.ZodString, "many">;
    tokens_used_estimate: z.ZodNumber;
    context_usage_pct: z.ZodEffects<z.ZodNumber, number, unknown>;
    compact_summary_for_round: z.ZodString;
    next_action: z.ZodEnum<["fix-required", "ready-to-implement", "ready-to-test", "blocked"]>;
    rejected_by_parser: z.ZodArray<z.ZodObject<{
        reason: z.ZodEnum<["tool_violation", "scope_violation", "schema_violation"]>;
        raw_excerpt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }, {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }>, "many">;
} & {
    thread_id: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    review_id: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    thread_id: string;
    review_id: string;
    design_id: string;
    stage: "design" | "code" | "fix";
    review_round: number;
    verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
    verdict_factors: {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    };
    conclusions: {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }[];
    open_questions: string[];
    tokens_used_estimate: number;
    context_usage_pct: number;
    compact_summary_for_round: string;
    next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
    rejected_by_parser: {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }[];
}, {
    design_id: string;
    stage: "design" | "code" | "fix";
    review_round: number;
    verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
    verdict_factors: {
        critical_count: number;
        important_count: number;
        affected_major_sections_count: number;
        has_open_design_decision: boolean;
        has_new_arch_concept: boolean;
        has_interdependent_rc: boolean;
        estimated_fix_lines: number;
        touched_module_count: number;
        has_design_gap: boolean;
    };
    conclusions: {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }[];
    open_questions: string[];
    tokens_used_estimate: number;
    compact_summary_for_round: string;
    next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
    rejected_by_parser: {
        reason: "tool_violation" | "scope_violation" | "schema_violation";
        raw_excerpt: string;
    }[];
    thread_id?: string | undefined;
    review_id?: string | undefined;
    context_usage_pct?: unknown;
}>;
export declare const AppliedEditType: z.ZodEnum<["added", "deleted", "replaced", "moved"]>;
export declare const AppliedEdit: z.ZodObject<{
    rc_ref: z.ZodString;
    files: z.ZodArray<z.ZodString, "many">;
    sections: z.ZodArray<z.ZodString, "many">;
    summary: z.ZodString;
    edit_type: z.ZodEnum<["added", "deleted", "replaced", "moved"]>;
}, "strip", z.ZodTypeAny, {
    rc_ref: string;
    files: string[];
    sections: string[];
    summary: string;
    edit_type: "added" | "deleted" | "replaced" | "moved";
}, {
    rc_ref: string;
    files: string[];
    sections: string[];
    summary: string;
    edit_type: "added" | "deleted" | "replaced" | "moved";
}>;
export type AppliedEdit = z.infer<typeof AppliedEdit>;
export declare const AppliedFix: z.ZodObject<{
    rc_ref: z.ZodString;
    files: z.ZodArray<z.ZodString, "many">;
    target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"file_line">;
        file: z.ZodString;
        line: z.ZodNullable<z.ZodNumber>;
        missing_artifact_kind: z.ZodOptional<z.ZodNull>;
        missing_artifact_path: z.ZodOptional<z.ZodNull>;
    }, "strip", z.ZodTypeAny, {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    }, {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"missing_artifact">;
        file: z.ZodOptional<z.ZodNull>;
        line: z.ZodOptional<z.ZodNull>;
        missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
        missing_artifact_path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    }, {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    }>]>;
    summary: z.ZodString;
    edit_type: z.ZodEnum<["added", "deleted", "replaced", "moved"]>;
}, "strip", z.ZodTypeAny, {
    target: {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    } | {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    };
    rc_ref: string;
    files: string[];
    summary: string;
    edit_type: "added" | "deleted" | "replaced" | "moved";
}, {
    target: {
        kind: "file_line";
        file: string;
        line: number | null;
        missing_artifact_kind?: null | undefined;
        missing_artifact_path?: null | undefined;
    } | {
        kind: "missing_artifact";
        missing_artifact_kind: "test" | "config" | "doc" | "module";
        missing_artifact_path: string;
        file?: null | undefined;
        line?: null | undefined;
    };
    rc_ref: string;
    files: string[];
    summary: string;
    edit_type: "added" | "deleted" | "replaced" | "moved";
}>;
export type AppliedFix = z.infer<typeof AppliedFix>;
export declare const DesignReviewInput: z.ZodObject<{
    design_id: z.ZodString;
    design_doc_paths: z.ZodArray<z.ZodString, "many">;
    task_card_path: z.ZodString;
    module_doc_paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    handoff_path: z.ZodString;
    triggers_hit: z.ZodArray<z.ZodString, "many">;
    previous_round_id: z.ZodOptional<z.ZodString>;
    previous_round_resolved: z.ZodOptional<z.ZodArray<z.ZodObject<{
        conclusion_id: z.ZodString;
        resolved: z.ZodBoolean;
        fix_evidence: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }, {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }>, "many">>;
    applied_edits: z.ZodOptional<z.ZodArray<z.ZodObject<{
        rc_ref: z.ZodString;
        files: z.ZodArray<z.ZodString, "many">;
        sections: z.ZodArray<z.ZodString, "many">;
        summary: z.ZodString;
        edit_type: z.ZodEnum<["added", "deleted", "replaced", "moved"]>;
    }, "strip", z.ZodTypeAny, {
        rc_ref: string;
        files: string[];
        sections: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }, {
        rc_ref: string;
        files: string[];
        sections: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }>, "many">>;
    force_new_thread: z.ZodOptional<z.ZodBoolean>;
    /** Manual provider two-phase submit (design §4.7 C2): path to the human-pasted verdict.json. */
    manual_verdict_path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    design_id: string;
    design_doc_paths: string[];
    task_card_path: string;
    handoff_path: string;
    triggers_hit: string[];
    module_doc_paths?: string[] | undefined;
    previous_round_id?: string | undefined;
    previous_round_resolved?: {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }[] | undefined;
    applied_edits?: {
        rc_ref: string;
        files: string[];
        sections: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }[] | undefined;
    force_new_thread?: boolean | undefined;
    manual_verdict_path?: string | undefined;
}, {
    design_id: string;
    design_doc_paths: string[];
    task_card_path: string;
    handoff_path: string;
    triggers_hit: string[];
    module_doc_paths?: string[] | undefined;
    previous_round_id?: string | undefined;
    previous_round_resolved?: {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }[] | undefined;
    applied_edits?: {
        rc_ref: string;
        files: string[];
        sections: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }[] | undefined;
    force_new_thread?: boolean | undefined;
    manual_verdict_path?: string | undefined;
}>;
export type DesignReviewInput = z.infer<typeof DesignReviewInput>;
export declare const CodeReviewInput: z.ZodObject<{
    design_id: z.ZodString;
    task_card_path: z.ZodString;
    design_doc_paths: z.ZodArray<z.ZodString, "many">;
    module_doc_paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    handoff_path: z.ZodString;
    diff_spec: z.ZodString;
    changed_files: z.ZodArray<z.ZodString, "many">;
    claude_output: z.ZodObject<{
        docsRead: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        sopChecks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        filesInScope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        filesChanged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        testsRun: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        validationEvidence: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        handoffUpdated: z.ZodOptional<z.ZodBoolean>;
        docsUpdated: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mode: z.ZodOptional<z.ZodString>;
        designReview: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        docsRead: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        sopChecks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        filesInScope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        filesChanged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        testsRun: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        validationEvidence: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        handoffUpdated: z.ZodOptional<z.ZodBoolean>;
        docsUpdated: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mode: z.ZodOptional<z.ZodString>;
        designReview: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        docsRead: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        sopChecks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        filesInScope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        filesChanged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        testsRun: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        validationEvidence: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        handoffUpdated: z.ZodOptional<z.ZodBoolean>;
        docsUpdated: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mode: z.ZodOptional<z.ZodString>;
        designReview: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    tests_run: z.ZodArray<z.ZodString, "many">;
    validation_evidence: z.ZodString;
    docs_updated: z.ZodArray<z.ZodString, "many">;
    previous_round_id: z.ZodOptional<z.ZodString>;
    previous_round_resolved: z.ZodOptional<z.ZodArray<z.ZodObject<{
        conclusion_id: z.ZodString;
        resolved: z.ZodBoolean;
        fix_evidence: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }, {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }>, "many">>;
    applied_fixes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        rc_ref: z.ZodString;
        files: z.ZodArray<z.ZodString, "many">;
        target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"file_line">;
            file: z.ZodString;
            line: z.ZodNullable<z.ZodNumber>;
            missing_artifact_kind: z.ZodOptional<z.ZodNull>;
            missing_artifact_path: z.ZodOptional<z.ZodNull>;
        }, "strip", z.ZodTypeAny, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"missing_artifact">;
            file: z.ZodOptional<z.ZodNull>;
            line: z.ZodOptional<z.ZodNull>;
            missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
            missing_artifact_path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }>]>;
        summary: z.ZodString;
        edit_type: z.ZodEnum<["added", "deleted", "replaced", "moved"]>;
    }, "strip", z.ZodTypeAny, {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }, {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }>, "many">>;
    /** Caller-driven thread reset for context_exhausted recovery. When true, server replaces
     * the active SDK thread on the design_id but PRESERVES rounds counters / history /
     * design_doc_files / scope_drift_lines_total / tokens_used_estimate_total. The old thread
     * is appended to state.thread_history. previous_round_id is NOT used for thread lookup
     * but IS still rendered into the prompt (audit chain continuity). */
    force_new_thread: z.ZodOptional<z.ZodBoolean>;
    /** Manual provider two-phase submit (design §4.7 C2): path to the human-pasted verdict.json. */
    manual_verdict_path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    design_id: string;
    design_doc_paths: string[];
    task_card_path: string;
    handoff_path: string;
    diff_spec: string;
    changed_files: string[];
    claude_output: {
        docsRead?: string[] | undefined;
        sopChecks?: Record<string, boolean> | undefined;
        filesInScope?: string[] | undefined;
        filesChanged?: string[] | undefined;
        testsRun?: string[] | undefined;
        validationEvidence?: string[] | undefined;
        handoffUpdated?: boolean | undefined;
        docsUpdated?: string[] | undefined;
        mode?: string | undefined;
        designReview?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    tests_run: string[];
    validation_evidence: string;
    docs_updated: string[];
    module_doc_paths?: string[] | undefined;
    previous_round_id?: string | undefined;
    previous_round_resolved?: {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }[] | undefined;
    force_new_thread?: boolean | undefined;
    manual_verdict_path?: string | undefined;
    applied_fixes?: {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }[] | undefined;
}, {
    design_id: string;
    design_doc_paths: string[];
    task_card_path: string;
    handoff_path: string;
    diff_spec: string;
    changed_files: string[];
    claude_output: {
        docsRead?: string[] | undefined;
        sopChecks?: Record<string, boolean> | undefined;
        filesInScope?: string[] | undefined;
        filesChanged?: string[] | undefined;
        testsRun?: string[] | undefined;
        validationEvidence?: string[] | undefined;
        handoffUpdated?: boolean | undefined;
        docsUpdated?: string[] | undefined;
        mode?: string | undefined;
        designReview?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    tests_run: string[];
    validation_evidence: string;
    docs_updated: string[];
    module_doc_paths?: string[] | undefined;
    previous_round_id?: string | undefined;
    previous_round_resolved?: {
        conclusion_id: string;
        resolved: boolean;
        fix_evidence?: string | undefined;
    }[] | undefined;
    force_new_thread?: boolean | undefined;
    manual_verdict_path?: string | undefined;
    applied_fixes?: {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }[] | undefined;
}>;
export type CodeReviewInput = z.infer<typeof CodeReviewInput>;
declare const ClaudeFixNote: z.ZodObject<{
    conclusion_id: z.ZodString;
    action: z.ZodEnum<["fixed", "deferred", "rejected"]>;
    evidence: z.ZodString;
    rationale: z.ZodString;
}, "strip", z.ZodTypeAny, {
    conclusion_id: string;
    evidence: string;
    action: "fixed" | "deferred" | "rejected";
    rationale: string;
}, {
    conclusion_id: string;
    evidence: string;
    action: "fixed" | "deferred" | "rejected";
    rationale: string;
}>;
export type ClaudeFixNote = z.infer<typeof ClaudeFixNote>;
export declare const FixReviewInput: z.ZodObject<{
    design_id: z.ZodString;
    task_card_path: z.ZodString;
    design_doc_paths: z.ZodArray<z.ZodString, "many">;
    module_doc_paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    handoff_path: z.ZodString;
    fix_diff_spec: z.ZodString;
    changed_files: z.ZodArray<z.ZodString, "many">;
    fix_diff_lines: z.ZodNumber;
    docs_updated: z.ZodArray<z.ZodString, "many">;
    claude_output: z.ZodObject<{
        docsRead: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        sopChecks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        filesInScope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        filesChanged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        testsRun: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        validationEvidence: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        handoffUpdated: z.ZodOptional<z.ZodBoolean>;
        docsUpdated: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mode: z.ZodOptional<z.ZodString>;
        designReview: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        docsRead: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        sopChecks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        filesInScope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        filesChanged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        testsRun: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        validationEvidence: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        handoffUpdated: z.ZodOptional<z.ZodBoolean>;
        docsUpdated: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mode: z.ZodOptional<z.ZodString>;
        designReview: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        docsRead: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        sopChecks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        filesInScope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        filesChanged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        testsRun: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        validationEvidence: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        handoffUpdated: z.ZodOptional<z.ZodBoolean>;
        docsUpdated: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mode: z.ZodOptional<z.ZodString>;
        designReview: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    claude_fix_notes: z.ZodArray<z.ZodObject<{
        conclusion_id: z.ZodString;
        action: z.ZodEnum<["fixed", "deferred", "rejected"]>;
        evidence: z.ZodString;
        rationale: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        conclusion_id: string;
        evidence: string;
        action: "fixed" | "deferred" | "rejected";
        rationale: string;
    }, {
        conclusion_id: string;
        evidence: string;
        action: "fixed" | "deferred" | "rejected";
        rationale: string;
    }>, "many">;
    previous_round_id: z.ZodString;
    previous_round_conclusions: z.ZodArray<z.ZodObject<{
        conclusion_id: z.ZodString;
        level: z.ZodEnum<["Critical", "Important", "Suggestion"]>;
        rule: z.ZodNullable<z.ZodString>;
        target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"file_line">;
            file: z.ZodString;
            line: z.ZodNullable<z.ZodNumber>;
            missing_artifact_kind: z.ZodOptional<z.ZodNull>;
            missing_artifact_path: z.ZodOptional<z.ZodNull>;
        }, "strip", z.ZodTypeAny, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"missing_artifact">;
            file: z.ZodOptional<z.ZodNull>;
            line: z.ZodOptional<z.ZodNull>;
            missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
            missing_artifact_path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }>]>;
        evidence: z.ZodString;
        fix: z.ZodString;
        auto_fix_class: z.ZodEnum<["auto", "manual-only", "deferred-to-next-round", "rejected-by-parser"]>;
    }, "strip", z.ZodTypeAny, {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }, {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }>, "many">;
    applied_fixes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        rc_ref: z.ZodString;
        files: z.ZodArray<z.ZodString, "many">;
        target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"file_line">;
            file: z.ZodString;
            line: z.ZodNullable<z.ZodNumber>;
            missing_artifact_kind: z.ZodOptional<z.ZodNull>;
            missing_artifact_path: z.ZodOptional<z.ZodNull>;
        }, "strip", z.ZodTypeAny, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }, {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"missing_artifact">;
            file: z.ZodOptional<z.ZodNull>;
            line: z.ZodOptional<z.ZodNull>;
            missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
            missing_artifact_path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }, {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        }>]>;
        summary: z.ZodString;
        edit_type: z.ZodEnum<["added", "deleted", "replaced", "moved"]>;
    }, "strip", z.ZodTypeAny, {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }, {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }>, "many">>;
    tests_run: z.ZodArray<z.ZodString, "many">;
    validation_evidence: z.ZodString;
    /** Same semantics as CodeReviewInput.force_new_thread; see that field. */
    force_new_thread: z.ZodOptional<z.ZodBoolean>;
    /** Manual provider two-phase submit (design §4.7 C2): path to the human-pasted verdict.json. */
    manual_verdict_path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    design_id: string;
    design_doc_paths: string[];
    task_card_path: string;
    handoff_path: string;
    previous_round_id: string;
    changed_files: string[];
    claude_output: {
        docsRead?: string[] | undefined;
        sopChecks?: Record<string, boolean> | undefined;
        filesInScope?: string[] | undefined;
        filesChanged?: string[] | undefined;
        testsRun?: string[] | undefined;
        validationEvidence?: string[] | undefined;
        handoffUpdated?: boolean | undefined;
        docsUpdated?: string[] | undefined;
        mode?: string | undefined;
        designReview?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    tests_run: string[];
    validation_evidence: string;
    docs_updated: string[];
    fix_diff_spec: string;
    fix_diff_lines: number;
    claude_fix_notes: {
        conclusion_id: string;
        evidence: string;
        action: "fixed" | "deferred" | "rejected";
        rationale: string;
    }[];
    previous_round_conclusions: {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }[];
    module_doc_paths?: string[] | undefined;
    force_new_thread?: boolean | undefined;
    manual_verdict_path?: string | undefined;
    applied_fixes?: {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }[] | undefined;
}, {
    design_id: string;
    design_doc_paths: string[];
    task_card_path: string;
    handoff_path: string;
    previous_round_id: string;
    changed_files: string[];
    claude_output: {
        docsRead?: string[] | undefined;
        sopChecks?: Record<string, boolean> | undefined;
        filesInScope?: string[] | undefined;
        filesChanged?: string[] | undefined;
        testsRun?: string[] | undefined;
        validationEvidence?: string[] | undefined;
        handoffUpdated?: boolean | undefined;
        docsUpdated?: string[] | undefined;
        mode?: string | undefined;
        designReview?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    tests_run: string[];
    validation_evidence: string;
    docs_updated: string[];
    fix_diff_spec: string;
    fix_diff_lines: number;
    claude_fix_notes: {
        conclusion_id: string;
        evidence: string;
        action: "fixed" | "deferred" | "rejected";
        rationale: string;
    }[];
    previous_round_conclusions: {
        fix: string;
        conclusion_id: string;
        level: "Critical" | "Important" | "Suggestion";
        rule: string | null;
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        evidence: string;
        auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
    }[];
    module_doc_paths?: string[] | undefined;
    force_new_thread?: boolean | undefined;
    manual_verdict_path?: string | undefined;
    applied_fixes?: {
        target: {
            kind: "file_line";
            file: string;
            line: number | null;
            missing_artifact_kind?: null | undefined;
            missing_artifact_path?: null | undefined;
        } | {
            kind: "missing_artifact";
            missing_artifact_kind: "test" | "config" | "doc" | "module";
            missing_artifact_path: string;
            file?: null | undefined;
            line?: null | undefined;
        };
        rc_ref: string;
        files: string[];
        summary: string;
        edit_type: "added" | "deleted" | "replaced" | "moved";
    }[] | undefined;
}>;
export type FixReviewInput = z.infer<typeof FixReviewInput>;
export declare const DesignDocFileState: z.ZodObject<{
    sha: z.ZodString;
    exists: z.ZodBoolean;
    last_seen_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sha: string;
    exists: boolean;
    last_seen_at: string;
}, {
    sha: string;
    exists: boolean;
    last_seen_at: string;
}>;
export type DesignDocFileState = z.infer<typeof DesignDocFileState>;
export declare const RoundHistoryEntry: z.ZodObject<{
    review_id: z.ZodString;
    stage: z.ZodEnum<["design", "code", "fix"]>;
    round: z.ZodNumber;
    verdict: z.ZodUnion<[z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>]>;
    compact_summary: z.ZodString;
    tokens_used_estimate: z.ZodNumber;
    ended_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    review_id: string;
    stage: "design" | "code" | "fix";
    verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
    tokens_used_estimate: number;
    round: number;
    compact_summary: string;
    ended_at: string;
}, {
    review_id: string;
    stage: "design" | "code" | "fix";
    verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
    tokens_used_estimate: number;
    round: number;
    compact_summary: string;
    ended_at: string;
}>;
export type RoundHistoryEntry = z.infer<typeof RoundHistoryEntry>;
/** Audit entry for an abandoned SDK thread within the same design_id. */
export declare const ThreadHistoryEntry: z.ZodObject<{
    thread_id: z.ZodString;
    abandoned_at_round: z.ZodObject<{
        design_review: z.ZodNumber;
        code_review: z.ZodNumber;
        fix_review: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        design_review: number;
        code_review: number;
        fix_review: number;
    }, {
        design_review: number;
        code_review: number;
        fix_review: number;
    }>;
    abandoned_at: z.ZodString;
    reason: z.ZodEnum<["force_new_thread", "context_force_new_thread_pct", "provider_switch"]>;
}, "strip", z.ZodTypeAny, {
    reason: "force_new_thread" | "context_force_new_thread_pct" | "provider_switch";
    thread_id: string;
    abandoned_at_round: {
        design_review: number;
        code_review: number;
        fix_review: number;
    };
    abandoned_at: string;
}, {
    reason: "force_new_thread" | "context_force_new_thread_pct" | "provider_switch";
    thread_id: string;
    abandoned_at_round: {
        design_review: number;
        code_review: number;
        fix_review: number;
    };
    abandoned_at: string;
}>;
export type ThreadHistoryEntry = z.infer<typeof ThreadHistoryEntry>;
export declare const ThreadState: z.ZodObject<{
    design_id: z.ZodString;
    thread_id: z.ZodString;
    thread_created_at: z.ZodString;
    /** Which provider owns thread_id (design §4.7 / Q7). Legacy states without this field
     * load as "codex" (the only pre-abstraction provider). */
    provider_kind: z.ZodDefault<z.ZodEnum<["codex", "claude", "manual"]>>;
    design_doc_files: z.ZodRecord<z.ZodString, z.ZodObject<{
        sha: z.ZodString;
        exists: z.ZodBoolean;
        last_seen_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sha: string;
        exists: boolean;
        last_seen_at: string;
    }, {
        sha: string;
        exists: boolean;
        last_seen_at: string;
    }>>;
    rounds: z.ZodObject<{
        design_review: z.ZodNumber;
        code_review: z.ZodNumber;
        fix_review: z.ZodNumber;
        history: z.ZodArray<z.ZodObject<{
            review_id: z.ZodString;
            stage: z.ZodEnum<["design", "code", "fix"]>;
            round: z.ZodNumber;
            verdict: z.ZodUnion<[z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>]>;
            compact_summary: z.ZodString;
            tokens_used_estimate: z.ZodNumber;
            ended_at: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            review_id: string;
            stage: "design" | "code" | "fix";
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            tokens_used_estimate: number;
            round: number;
            compact_summary: string;
            ended_at: string;
        }, {
            review_id: string;
            stage: "design" | "code" | "fix";
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            tokens_used_estimate: number;
            round: number;
            compact_summary: string;
            ended_at: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        design_review: number;
        code_review: number;
        fix_review: number;
        history: {
            review_id: string;
            stage: "design" | "code" | "fix";
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            tokens_used_estimate: number;
            round: number;
            compact_summary: string;
            ended_at: string;
        }[];
    }, {
        design_review: number;
        code_review: number;
        fix_review: number;
        history: {
            review_id: string;
            stage: "design" | "code" | "fix";
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            tokens_used_estimate: number;
            round: number;
            compact_summary: string;
            ended_at: string;
        }[];
    }>;
    tokens_used_estimate_total: z.ZodNumber;
    /** Cumulative fix diff lines since the implement (§5.2 scope_drift). */
    scope_drift_lines_total: z.ZodDefault<z.ZodNumber>;
    /** Audit trail of SDK threads that were abandoned within this design_id (force_new_thread
     * caller-driven OR context_force_new_thread_pct context-driven). Old states without this
     * field load as []. */
    thread_history: z.ZodDefault<z.ZodArray<z.ZodObject<{
        thread_id: z.ZodString;
        abandoned_at_round: z.ZodObject<{
            design_review: z.ZodNumber;
            code_review: z.ZodNumber;
            fix_review: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            design_review: number;
            code_review: number;
            fix_review: number;
        }, {
            design_review: number;
            code_review: number;
            fix_review: number;
        }>;
        abandoned_at: z.ZodString;
        reason: z.ZodEnum<["force_new_thread", "context_force_new_thread_pct", "provider_switch"]>;
    }, "strip", z.ZodTypeAny, {
        reason: "force_new_thread" | "context_force_new_thread_pct" | "provider_switch";
        thread_id: string;
        abandoned_at_round: {
            design_review: number;
            code_review: number;
            fix_review: number;
        };
        abandoned_at: string;
    }, {
        reason: "force_new_thread" | "context_force_new_thread_pct" | "provider_switch";
        thread_id: string;
        abandoned_at_round: {
            design_review: number;
            code_review: number;
            fix_review: number;
        };
        abandoned_at: string;
    }>, "many">>;
    context_usage_pct: z.ZodEffects<z.ZodNumber, number, unknown>;
    /** Manual provider submit idempotency (design §4.7): the last ingested manual verdict's
     * sha256 + the envelope it produced. Resubmitting the same verdict returns this envelope
     * verbatim (same review_id, no round bump). Absent for non-manual / pre-slice-3 states. */
    last_manual_submit: z.ZodOptional<z.ZodObject<{
        verdict_sha: z.ZodString;
        envelope: z.ZodObject<{
            thread_id: z.ZodString;
            review_id: z.ZodString;
            design_id: z.ZodString;
            stage: z.ZodEnum<["design", "code", "fix"]>;
            review_round: z.ZodNumber;
            verdict: z.ZodUnion<[z.ZodEnum<["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]>, z.ZodEnum<["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]>]>;
            verdict_factors: z.ZodObject<{
                critical_count: z.ZodNumber;
                important_count: z.ZodNumber;
                affected_major_sections_count: z.ZodNumber;
                has_open_design_decision: z.ZodBoolean;
                has_new_arch_concept: z.ZodBoolean;
                has_interdependent_rc: z.ZodBoolean;
                estimated_fix_lines: z.ZodNumber;
                touched_module_count: z.ZodNumber;
                has_design_gap: z.ZodBoolean;
            }, "strip", z.ZodTypeAny, {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            }, {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            }>;
            conclusions: z.ZodArray<z.ZodObject<{
                conclusion_id: z.ZodString;
                level: z.ZodEnum<["Critical", "Important", "Suggestion"]>;
                rule: z.ZodNullable<z.ZodString>;
                target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"file_line">;
                    file: z.ZodString;
                    line: z.ZodNullable<z.ZodNumber>;
                    missing_artifact_kind: z.ZodOptional<z.ZodNull>;
                    missing_artifact_path: z.ZodOptional<z.ZodNull>;
                }, "strip", z.ZodTypeAny, {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                }, {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"missing_artifact">;
                    file: z.ZodOptional<z.ZodNull>;
                    line: z.ZodOptional<z.ZodNull>;
                    missing_artifact_kind: z.ZodEnum<["test", "config", "doc", "module"]>;
                    missing_artifact_path: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                }, {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                }>]>;
                evidence: z.ZodString;
                fix: z.ZodString;
                auto_fix_class: z.ZodEnum<["auto", "manual-only", "deferred-to-next-round", "rejected-by-parser"]>;
            }, "strip", z.ZodTypeAny, {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }, {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }>, "many">;
            open_questions: z.ZodArray<z.ZodString, "many">;
            tokens_used_estimate: z.ZodNumber;
            context_usage_pct: z.ZodEffects<z.ZodNumber, number, unknown>;
            compact_summary_for_round: z.ZodString;
            next_action: z.ZodEnum<["fix-required", "ready-to-implement", "ready-to-test", "blocked"]>;
            rejected_by_parser: z.ZodArray<z.ZodObject<{
                reason: z.ZodEnum<["tool_violation", "scope_violation", "schema_violation"]>;
                raw_excerpt: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }, {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            thread_id: string;
            review_id: string;
            design_id: string;
            stage: "design" | "code" | "fix";
            review_round: number;
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            verdict_factors: {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            };
            conclusions: {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }[];
            open_questions: string[];
            tokens_used_estimate: number;
            context_usage_pct: number;
            compact_summary_for_round: string;
            next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
            rejected_by_parser: {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }[];
        }, {
            thread_id: string;
            review_id: string;
            design_id: string;
            stage: "design" | "code" | "fix";
            review_round: number;
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            verdict_factors: {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            };
            conclusions: {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }[];
            open_questions: string[];
            tokens_used_estimate: number;
            compact_summary_for_round: string;
            next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
            rejected_by_parser: {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }[];
            context_usage_pct?: unknown;
        }>;
    }, "strip", z.ZodTypeAny, {
        verdict_sha: string;
        envelope: {
            thread_id: string;
            review_id: string;
            design_id: string;
            stage: "design" | "code" | "fix";
            review_round: number;
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            verdict_factors: {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            };
            conclusions: {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }[];
            open_questions: string[];
            tokens_used_estimate: number;
            context_usage_pct: number;
            compact_summary_for_round: string;
            next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
            rejected_by_parser: {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }[];
        };
    }, {
        verdict_sha: string;
        envelope: {
            thread_id: string;
            review_id: string;
            design_id: string;
            stage: "design" | "code" | "fix";
            review_round: number;
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            verdict_factors: {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            };
            conclusions: {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }[];
            open_questions: string[];
            tokens_used_estimate: number;
            compact_summary_for_round: string;
            next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
            rejected_by_parser: {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }[];
            context_usage_pct?: unknown;
        };
    }>>;
    archived: z.ZodBoolean;
    lock_holder_pid: z.ZodNullable<z.ZodNumber>;
    lock_acquired_at: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    thread_id: string;
    design_id: string;
    context_usage_pct: number;
    thread_created_at: string;
    provider_kind: "codex" | "claude" | "manual";
    design_doc_files: Record<string, {
        sha: string;
        exists: boolean;
        last_seen_at: string;
    }>;
    rounds: {
        design_review: number;
        code_review: number;
        fix_review: number;
        history: {
            review_id: string;
            stage: "design" | "code" | "fix";
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            tokens_used_estimate: number;
            round: number;
            compact_summary: string;
            ended_at: string;
        }[];
    };
    tokens_used_estimate_total: number;
    scope_drift_lines_total: number;
    thread_history: {
        reason: "force_new_thread" | "context_force_new_thread_pct" | "provider_switch";
        thread_id: string;
        abandoned_at_round: {
            design_review: number;
            code_review: number;
            fix_review: number;
        };
        abandoned_at: string;
    }[];
    archived: boolean;
    lock_holder_pid: number | null;
    lock_acquired_at: string | null;
    last_manual_submit?: {
        verdict_sha: string;
        envelope: {
            thread_id: string;
            review_id: string;
            design_id: string;
            stage: "design" | "code" | "fix";
            review_round: number;
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            verdict_factors: {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            };
            conclusions: {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }[];
            open_questions: string[];
            tokens_used_estimate: number;
            context_usage_pct: number;
            compact_summary_for_round: string;
            next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
            rejected_by_parser: {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }[];
        };
    } | undefined;
}, {
    thread_id: string;
    design_id: string;
    thread_created_at: string;
    design_doc_files: Record<string, {
        sha: string;
        exists: boolean;
        last_seen_at: string;
    }>;
    rounds: {
        design_review: number;
        code_review: number;
        fix_review: number;
        history: {
            review_id: string;
            stage: "design" | "code" | "fix";
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            tokens_used_estimate: number;
            round: number;
            compact_summary: string;
            ended_at: string;
        }[];
    };
    tokens_used_estimate_total: number;
    archived: boolean;
    lock_holder_pid: number | null;
    lock_acquired_at: string | null;
    context_usage_pct?: unknown;
    provider_kind?: "codex" | "claude" | "manual" | undefined;
    scope_drift_lines_total?: number | undefined;
    thread_history?: {
        reason: "force_new_thread" | "context_force_new_thread_pct" | "provider_switch";
        thread_id: string;
        abandoned_at_round: {
            design_review: number;
            code_review: number;
            fix_review: number;
        };
        abandoned_at: string;
    }[] | undefined;
    last_manual_submit?: {
        verdict_sha: string;
        envelope: {
            thread_id: string;
            review_id: string;
            design_id: string;
            stage: "design" | "code" | "fix";
            review_round: number;
            verdict: "Go" | "Go-after-fixes" | "Rereview-after-fixes" | "No-Go" | "Pass" | "Pass-after-fixes" | "All-fixed" | "Partial" | "New-issues";
            verdict_factors: {
                critical_count: number;
                important_count: number;
                affected_major_sections_count: number;
                has_open_design_decision: boolean;
                has_new_arch_concept: boolean;
                has_interdependent_rc: boolean;
                estimated_fix_lines: number;
                touched_module_count: number;
                has_design_gap: boolean;
            };
            conclusions: {
                fix: string;
                conclusion_id: string;
                level: "Critical" | "Important" | "Suggestion";
                rule: string | null;
                target: {
                    kind: "file_line";
                    file: string;
                    line: number | null;
                    missing_artifact_kind?: null | undefined;
                    missing_artifact_path?: null | undefined;
                } | {
                    kind: "missing_artifact";
                    missing_artifact_kind: "test" | "config" | "doc" | "module";
                    missing_artifact_path: string;
                    file?: null | undefined;
                    line?: null | undefined;
                };
                evidence: string;
                auto_fix_class: "auto" | "manual-only" | "deferred-to-next-round" | "rejected-by-parser";
            }[];
            open_questions: string[];
            tokens_used_estimate: number;
            compact_summary_for_round: string;
            next_action: "fix-required" | "ready-to-implement" | "ready-to-test" | "blocked";
            rejected_by_parser: {
                reason: "tool_violation" | "scope_violation" | "schema_violation";
                raw_excerpt: string;
            }[];
            context_usage_pct?: unknown;
        };
    } | undefined;
}>;
export type ThreadState = z.infer<typeof ThreadState>;
export {};
//# sourceMappingURL=types.d.ts.map