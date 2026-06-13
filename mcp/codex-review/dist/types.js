// Shared types for the codex-review MCP bridge.
//
// Spec source: docs/methodology/codex-review-bridge-design.md
//   §3.0 envelope structure
//   §3.0.1 verdict / verdict_factors / target / post-action
import { z } from "zod";
// ---------- Stage & verdicts ----------
export const ReviewStage = z.enum(["design", "code", "fix"]);
// Review backend kind (design §4.7 provider abstraction). Single source reused by
// config.ts (config.review.provider) and review-provider.ts (ReviewProvider.kind).
export const ProviderKindSchema = z.enum(["codex", "claude", "manual"]);
// New verdict enums (post round-2/3 protocol patch). Old enums are explicitly rejected.
export const DesignVerdict = z.enum([
    "Go",
    "Go-after-fixes",
    "Rereview-after-fixes",
    "No-Go",
]);
export const CodeVerdict = z.enum([
    "Pass",
    "Pass-after-fixes",
    "Rereview-after-fixes",
    "No-Go",
]);
export const FixVerdict = z.enum([
    "All-fixed",
    "Partial",
    "New-issues",
    "Rereview-after-fixes",
    "No-Go",
]);
export const AnyVerdict = z.union([DesignVerdict, CodeVerdict, FixVerdict]);
// Old enums that must be rejected by output-parser (§3.0.1.G.1).
export const REJECTED_OLD_VERDICTS = new Set([
    "Go-with-required-changes",
    "Critical-must-fix",
    "Important-should-fix",
    "Suggestion-only",
]);
// ---------- verdict_factors (9 fields, all required) ----------
export const VerdictFactors = z.object({
    critical_count: z.number().int().nonnegative(),
    important_count: z.number().int().nonnegative(),
    affected_major_sections_count: z.number().int().nonnegative(),
    has_open_design_decision: z.boolean(),
    has_new_arch_concept: z.boolean(),
    has_interdependent_rc: z.boolean(),
    estimated_fix_lines: z.number().int().nonnegative(),
    touched_module_count: z.number().int().nonnegative(),
    has_design_gap: z.boolean(),
});
export const VERDICT_FACTOR_KEYS = [
    "critical_count",
    "important_count",
    "affected_major_sections_count",
    "has_open_design_decision",
    "has_new_arch_concept",
    "has_interdependent_rc",
    "estimated_fix_lines",
    "touched_module_count",
    "has_design_gap",
];
// ---------- Conclusion target (file_line / missing_artifact, §3.0.1.D) ----------
export const TargetFileLine = z.object({
    kind: z.literal("file_line"),
    file: z.string().min(1),
    line: z.number().int().positive().nullable(),
    missing_artifact_kind: z.null().optional(),
    missing_artifact_path: z.null().optional(),
});
export const MissingArtifactKind = z.enum(["test", "config", "doc", "module"]);
export const TargetMissingArtifact = z.object({
    kind: z.literal("missing_artifact"),
    file: z.null().optional(),
    line: z.null().optional(),
    missing_artifact_kind: MissingArtifactKind,
    missing_artifact_path: z.string().min(1),
});
export const ConclusionTarget = z.discriminatedUnion("kind", [
    TargetFileLine,
    TargetMissingArtifact,
]);
// ---------- Conclusion ----------
export const ConclusionLevel = z.enum(["Critical", "Important", "Suggestion"]);
export const AutoFixClass = z.enum([
    "auto",
    "manual-only",
    "deferred-to-next-round",
    "rejected-by-parser",
]);
export const Conclusion = z.object({
    conclusion_id: z.string().min(1),
    level: ConclusionLevel,
    rule: z.string().nullable(),
    target: ConclusionTarget,
    evidence: z.string(),
    fix: z.string(),
    auto_fix_class: AutoFixClass,
});
// ---------- next_action ----------
export const NextAction = z.enum([
    "fix-required",
    "ready-to-implement",
    "ready-to-test",
    "blocked",
]);
// ---------- Rejected by parser ----------
export const RejectedReason = z.enum([
    "tool_violation",
    "scope_violation",
    "schema_violation",
]);
export const RejectedItem = z.object({
    reason: RejectedReason,
    raw_excerpt: z.string(),
});
// ---------- context_usage_pct 归一(parser tolerance) ----------
// Codex 偶发把 context_usage_pct 当百分数发(如 35 而非 0.35)。裸 z.number().max(1)
// 会因此 zod-reject 掉整个 envelope —— 但 review substance 实为 authoritative(verdict /
// conclusions 都在),不该因这一个表征字段丢整份结论。这里在校验前归一:>1 视为百分数
// → /100;>100(异常上界)→ clamp 到 1。**必须 coerce 而非放宽 .max**:下游 context-monitor
// 按分数阈值(warn=0.6 / force_new_thread=0.8)判断,若直接收 35 会永远触发 force-rebuild。
// 同源教训见 a626061(CodexEmittedEnvelope 容忍 server-authoritative 字段省略)。
export const ContextUsagePct = z.preprocess((v) => typeof v === "number" && Number.isFinite(v) && v > 1
    ? v > 100
        ? 1
        : v / 100
    : v, z.number().min(0).max(1));
// ---------- Review envelope (§3.0) ----------
export const ReviewEnvelope = z.object({
    thread_id: z.string().min(1),
    review_id: z.string().min(1),
    design_id: z.string().min(1),
    stage: ReviewStage,
    review_round: z.number().int().positive(),
    verdict: AnyVerdict,
    verdict_factors: VerdictFactors,
    conclusions: z.array(Conclusion),
    open_questions: z.array(z.string()),
    tokens_used_estimate: z.number().nonnegative(),
    context_usage_pct: ContextUsagePct,
    compact_summary_for_round: z.string().max(2000),
    next_action: NextAction,
    rejected_by_parser: z.array(RejectedItem),
});
// Placeholder for server-authoritative envelope fields when Codex omits them.
// Always overwritten by run-review-flow §9 before the envelope is returned.
export const SERVER_OVERRIDE_PLACEHOLDER = "pending-server-override";
// Parse-stage schema. `thread_id` / `review_id` are server-authoritative: the
// server overrides both post-parse with the real SDK Thread.id + generated
// review_id (see run-review-flow §9, design §15.11 Round 4 修正), so whatever
// Codex emits is discarded. Codex intermittently omits these fields entirely;
// the strict ReviewEnvelope would then reject the whole review as a
// schema_violation. This schema relaxes only those two fields and fills a
// placeholder so the post-override contract (ReviewEnvelope) still holds.
export const CodexEmittedEnvelope = ReviewEnvelope.extend({
    thread_id: z.string().min(1).optional().default(SERVER_OVERRIDE_PLACEHOLDER),
    review_id: z.string().min(1).optional().default(SERVER_OVERRIDE_PLACEHOLDER),
});
// ---------- Applied edits / fixes (§3.0 入参补) ----------
export const AppliedEditType = z.enum(["added", "deleted", "replaced", "moved"]);
export const AppliedEdit = z.object({
    rc_ref: z.string(),
    files: z.array(z.string()),
    sections: z.array(z.string()),
    summary: z.string(),
    edit_type: AppliedEditType,
});
export const AppliedFix = z.object({
    rc_ref: z.string(),
    files: z.array(z.string()),
    target: ConclusionTarget,
    summary: z.string(),
    edit_type: AppliedEditType,
});
// ---------- Tool inputs (§3.1 / §3.2 / §3.3) ----------
const PreviousResolved = z.object({
    conclusion_id: z.string(),
    resolved: z.boolean(),
    fix_evidence: z.string().optional(),
});
const ClaudeOutput = z.object({
    docsRead: z.array(z.string()).optional(),
    sopChecks: z.record(z.boolean()).optional(),
    filesInScope: z.array(z.string()).optional(),
    filesChanged: z.array(z.string()).optional(),
    testsRun: z.array(z.string()).optional(),
    validationEvidence: z.array(z.string()).optional(),
    handoffUpdated: z.boolean().optional(),
    docsUpdated: z.array(z.string()).optional(),
    mode: z.string().optional(),
    designReview: z.string().optional(),
}).passthrough();
export const DesignReviewInput = z.object({
    design_id: z.string().min(1),
    design_doc_paths: z.array(z.string()).min(1),
    task_card_path: z.string().min(1),
    module_doc_paths: z.array(z.string()).optional(),
    handoff_path: z.string().min(1),
    triggers_hit: z.array(z.string()).min(1),
    previous_round_id: z.string().optional(),
    previous_round_resolved: z.array(PreviousResolved).optional(),
    applied_edits: z.array(AppliedEdit).optional(),
    force_new_thread: z.boolean().optional(),
    /** Manual provider two-phase submit (design §4.7 C2): path to the human-pasted verdict.json. */
    manual_verdict_path: z.string().optional(),
});
export const CodeReviewInput = z.object({
    design_id: z.string().min(1),
    task_card_path: z.string().min(1),
    design_doc_paths: z.array(z.string()).min(1),
    module_doc_paths: z.array(z.string()).optional(),
    handoff_path: z.string().min(1),
    diff_spec: z.string().min(1),
    changed_files: z.array(z.string()).min(1),
    claude_output: ClaudeOutput,
    tests_run: z.array(z.string()).min(1),
    validation_evidence: z.string().min(1),
    docs_updated: z.array(z.string()),
    previous_round_id: z.string().optional(),
    previous_round_resolved: z.array(PreviousResolved).optional(),
    applied_fixes: z.array(AppliedFix).optional(),
    /** Caller-driven thread reset for context_exhausted recovery. When true, server replaces
     * the active SDK thread on the design_id but PRESERVES rounds counters / history /
     * design_doc_files / scope_drift_lines_total / tokens_used_estimate_total. The old thread
     * is appended to state.thread_history. previous_round_id is NOT used for thread lookup
     * but IS still rendered into the prompt (audit chain continuity). */
    force_new_thread: z.boolean().optional(),
    /** Manual provider two-phase submit (design §4.7 C2): path to the human-pasted verdict.json. */
    manual_verdict_path: z.string().optional(),
});
const ClaudeFixNote = z.object({
    conclusion_id: z.string(),
    action: z.enum(["fixed", "deferred", "rejected"]),
    evidence: z.string(),
    rationale: z.string(),
});
export const FixReviewInput = z.object({
    design_id: z.string().min(1),
    task_card_path: z.string().min(1),
    design_doc_paths: z.array(z.string()).min(1),
    module_doc_paths: z.array(z.string()).optional(),
    handoff_path: z.string().min(1),
    fix_diff_spec: z.string().min(1),
    changed_files: z.array(z.string()).min(1),
    // Cumulative scope_drift accounting (design §5.2). Required for the scope_drift breaker to fire.
    // Caller (Claude orchestrator) computes this from `git diff --stat` of the fix range, in lines
    // excluding blank/comment.
    fix_diff_lines: z.number().int().nonnegative(),
    docs_updated: z.array(z.string()),
    claude_output: ClaudeOutput,
    claude_fix_notes: z.array(ClaudeFixNote).min(1),
    previous_round_id: z.string().min(1),
    previous_round_conclusions: z.array(Conclusion).min(1),
    applied_fixes: z.array(AppliedFix).optional(),
    tests_run: z.array(z.string()).min(1),
    validation_evidence: z.string().min(1),
    /** Same semantics as CodeReviewInput.force_new_thread; see that field. */
    force_new_thread: z.boolean().optional(),
    /** Manual provider two-phase submit (design §4.7 C2): path to the human-pasted verdict.json. */
    manual_verdict_path: z.string().optional(),
});
// ---------- Thread state file (§4.1) ----------
export const DesignDocFileState = z.object({
    sha: z.string(),
    exists: z.boolean(),
    last_seen_at: z.string(),
});
export const RoundHistoryEntry = z.object({
    review_id: z.string(),
    stage: ReviewStage,
    round: z.number().int().positive(),
    verdict: AnyVerdict,
    compact_summary: z.string(),
    tokens_used_estimate: z.number().nonnegative(),
    ended_at: z.string(),
});
/** Audit entry for an abandoned SDK thread within the same design_id. */
export const ThreadHistoryEntry = z.object({
    thread_id: z.string(),
    abandoned_at_round: z.object({
        design_review: z.number().int().nonnegative(),
        code_review: z.number().int().nonnegative(),
        fix_review: z.number().int().nonnegative(),
    }),
    abandoned_at: z.string(),
    // provider_switch added in slice 2 (Q7): config.review.provider != session provider_kind
    // invalidates the old session (no cross-provider thread/history reuse).
    reason: z.enum([
        "force_new_thread",
        "context_force_new_thread_pct",
        "provider_switch",
    ]),
});
export const ThreadState = z.object({
    design_id: z.string(),
    thread_id: z.string(),
    thread_created_at: z.string(),
    /** Which provider owns thread_id (design §4.7 / Q7). Legacy states without this field
     * load as "codex" (the only pre-abstraction provider). */
    provider_kind: ProviderKindSchema.default("codex"),
    design_doc_files: z.record(DesignDocFileState),
    rounds: z.object({
        design_review: z.number().int().nonnegative(),
        code_review: z.number().int().nonnegative(),
        fix_review: z.number().int().nonnegative(),
        history: z.array(RoundHistoryEntry),
    }),
    tokens_used_estimate_total: z.number().nonnegative(),
    /** Cumulative fix diff lines since the implement (§5.2 scope_drift). */
    scope_drift_lines_total: z.number().int().nonnegative().default(0),
    /** Audit trail of SDK threads that were abandoned within this design_id (force_new_thread
     * caller-driven OR context_force_new_thread_pct context-driven). Old states without this
     * field load as []. */
    thread_history: z.array(ThreadHistoryEntry).default([]),
    context_usage_pct: ContextUsagePct,
    /** Manual provider submit idempotency (design §4.7): the last ingested manual verdict's
     * sha256 + the envelope it produced. Resubmitting the same verdict returns this envelope
     * verbatim (same review_id, no round bump). Absent for non-manual / pre-slice-3 states. */
    last_manual_submit: z
        .object({ verdict_sha: z.string(), envelope: ReviewEnvelope })
        .optional(),
    archived: z.boolean(),
    lock_holder_pid: z.number().int().nullable(),
    lock_acquired_at: z.string().nullable(),
});
//# sourceMappingURL=types.js.map