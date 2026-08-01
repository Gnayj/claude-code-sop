// Codex output parser: schema validation + predicate evaluation + force-upgrade + tiebreaker.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §3.0.1 (A/B/C/D/E/F/G)
//   §6.1.2: output-parser fail-closed danger-verb filter
//   §15.7  M2: 9-factor required, missing -> conservative downgrade
//   §15.7  M3: target.kind = file_line | missing_artifact (二选一)
//   §15.8  D3: NO exception to conservative downgrade

import type { ResolvedConfig } from "./config.js";
import { effectiveDangerVerbsRegex } from "./safety.js";
import {
  AnyVerdict,
  Conclusion,
  DesignVerdict,
  CodeVerdict,
  FixVerdict,
  REJECTED_OLD_VERDICTS,
  ReviewEnvelope,
  ReviewStructuredPayload,
  REVIEW_MODEL_OUTPUT_KEYS,
  ContextUsagePct,
  VerdictFactors as VerdictFactorsSchema,
  type ReviewStage,
  type VerdictFactors,
  type RejectedItem,
} from "./types.js";

// ---------- Public surface ----------

export interface ParseSuccess {
  ok: true;
  envelope: ReviewEnvelope;
  warnings: string[];
  /** True if parser forced verdict more conservative than what Codex returned. */
  forced_upgrade: boolean;
  /** True if any verdict_factor was missing/invalid -> downgraded. */
  downgraded_for_missing_factors: boolean;
}

export interface ParseFailure {
  ok: false;
  reason:
    | "schema_violation"
    | "old_verdict_rejected"
    | "stage_verdict_mismatch"
    | "fix_missing_previous_round_resolved"
    | "non_json";
  detail: string;
  /** Raw payload Codex returned, for logging / retry. */
  raw_excerpt: string;
  /** Full local audit artifact, attached by runReviewFlow only when provider raw existed. */
  raw_output?: {
    path: string;
    sha256: string;
    bytes: number;
  };
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ParseContext {
  stage: ReviewStage;
  config: ResolvedConfig;
  /** previous_round_resolved provided by caller; required when stage='fix'. */
  hasPreviousRoundResolved: boolean;
  designId: string;
  threadId: string;
  reviewId: string;
  reviewRound: number;
  tokensUsedEstimate: number;
}

// ---------- Main entry ----------

export function parseCodexOutput(
  rawText: string,
  ctx: ParseContext,
): ParseResult {
  const invalidContext = invalidParseContextDetail(ctx);
  if (invalidContext !== null) {
    return {
      ok: false,
      reason: "schema_violation",
      detail: `server parse context invalid: ${invalidContext}`,
      raw_excerpt: clipRaw(rawText),
    };
  }
  // 1) JSON parse (lenient: tolerate code-fence wrappers and prefix prose).
  const candidate = extractJsonCandidate(rawText);
  if (candidate === null) {
    return {
      ok: false,
      reason: "non_json",
      detail: "could not locate a top-level JSON object in Codex output",
      raw_excerpt: clipRaw(rawText),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return {
      ok: false,
      reason: "non_json",
      detail: `JSON parse error: ${(err as Error).message}`,
      raw_excerpt: clipRaw(candidate),
    };
  }

  // 2) Reject old verdict enums (§3.0.1.G.1).
  const candidateVerdict = (parsed as { verdict?: unknown }).verdict;
  if (
    typeof candidateVerdict === "string" &&
    REJECTED_OLD_VERDICTS.has(candidateVerdict)
  ) {
    return {
      ok: false,
      reason: "old_verdict_rejected",
      detail: `verdict="${candidateVerdict}" is from the old enum; use the new enum per §3.0.1`,
      raw_excerpt: clipRaw(candidate),
    };
  }

  // 3) Verdict belongs to its declared stage.
  const stageVerdictSchema = stageVerdictEnum(ctx.stage);
  if (typeof candidateVerdict !== "string") {
    return {
      ok: false,
      reason: "schema_violation",
      detail: "verdict missing or not a string",
      raw_excerpt: clipRaw(candidate),
    };
  }
  if (!stageVerdictSchema.options.includes(candidateVerdict as never)) {
    return {
      ok: false,
      reason: "stage_verdict_mismatch",
      detail: `verdict="${candidateVerdict}" not allowed for stage=${ctx.stage}; expected one of ${stageVerdictSchema.options.join(", ")}`,
      raw_excerpt: clipRaw(candidate),
    };
  }

  // 4) verdict_factors check — track missing fields explicitly (do not let zod abort early).
  const downgradeForMissing = !hasAllFactors(parsed);

  // 4.A) Project legacy 14-key envelopes onto the seven model-owned keys, normalize the
  // permissive historical target/context forms, and keep summary overflow non-fatal.
  const normalized = normalizeReviewerPayload(parsed);

  // 5) Validate only reviewer-owned substance. Runtime/audit fields are assembled from ctx.
  const validation = ReviewStructuredPayload.safeParse(normalized.payload);
  if (!validation.success) {
    // If failure is purely the verdict_factors being incomplete, we'll still synthesize a downgraded envelope.
    if (!downgradeForMissing) {
      return {
        ok: false,
        reason: "schema_violation",
        detail: validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
        raw_excerpt: clipRaw(candidate),
      };
    }
    // Synthesize a minimum-viable envelope only if all *non-factor* fields are present;
    // otherwise return schema_violation so parser_unavailable streak counts.
    const synth = synthesizeDowngraded(normalized.payload, ctx);
    if (synth === null) {
      return {
        ok: false,
        reason: "schema_violation",
        detail:
          "verdict_factors malformed AND core envelope fields invalid: " +
          validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        raw_excerpt: clipRaw(candidate),
      };
    }
    return finishWithUpgrades(synth, ctx, {
      warnings: [
        ...normalized.warnings,
        "verdict_factors had missing/invalid fields; downgraded to conservative verdict and reset factors to safe values.",
      ],
      downgraded_for_missing_factors: true,
    });
  }

  // 6) Stage-specific extra invariants.
  if (ctx.stage === "fix" && !ctx.hasPreviousRoundResolved) {
    return {
      ok: false,
      reason: "fix_missing_previous_round_resolved",
      detail: "fix stage requires previous_round_resolved input from caller",
      raw_excerpt: clipRaw(candidate),
    };
  }

  // 7) Conservative downgrade if Codex put garbage values in factors (caught earlier).
  return finishWithUpgrades(assembleEnvelope(validation.data, ctx), ctx, {
    warnings: normalized.warnings,
    downgraded_for_missing_factors: false,
  });
}

// ---------- Predicate evaluation + force-upgrade + tiebreaker ----------

function finishWithUpgrades(
  envelope: ReviewEnvelope,
  ctx: ParseContext,
  meta: { warnings: string[]; downgraded_for_missing_factors: boolean },
): ParseSuccess {
  const warnings = [...meta.warnings];
  // a) Reject conclusions whose target is malformed (already caught by zod for the discriminated union),
  //    but verify file_line vs missing_artifact mutual exclusion semantics + dangerous fix-text.
  const dangerRe = effectiveDangerVerbsRegex(ctx.config);
  const filteredConclusions: Conclusion[] = [];
  const rejectedAdditions: RejectedItem[] = [];
  for (const c of envelope.conclusions) {
    if (dangerRe.test(c.fix)) {
      rejectedAdditions.push({
        reason: "tool_violation",
        raw_excerpt: c.fix,
      });
      continue;
    }
    // Suggestion narrow-exception: secondary check on auto_fix_class=auto.
    if (c.level === "Suggestion" && c.auto_fix_class === "auto") {
      const downgraded = secondaryNarrowCheck(c);
      filteredConclusions.push(downgraded);
      if (downgraded.auto_fix_class !== "auto") {
        warnings.push(
          `Suggestion ${c.conclusion_id} forced to manual-only (narrow-exception keyword hit).`,
        );
      }
    } else {
      filteredConclusions.push(c);
    }
  }
  const cleanedEnvelope: ReviewEnvelope = {
    ...envelope,
    conclusions: filteredConclusions,
    rejected_by_parser: [...envelope.rejected_by_parser, ...rejectedAdditions],
  };

  // b) Predicate evaluation.
  const expected = evaluatePredicate(
    ctx.stage,
    cleanedEnvelope.verdict,
    cleanedEnvelope.verdict_factors,
    ctx.config,
  );

  let finalVerdict = cleanedEnvelope.verdict;
  let forcedUpgrade = false;
  if (expected !== null && isMoreConservative(ctx.stage, expected, finalVerdict)) {
    forcedUpgrade = true;
    warnings.push(
      `verdict="${finalVerdict}" inconsistent with verdict_factors; forced to "${expected}" per §3.0.1.G.3.`,
    );
    finalVerdict = expected;
  }

  // c) Tiebreaker: ensure final picks the most conservative when multiple verdicts could apply.
  finalVerdict = applyTiebreakers(ctx.stage, finalVerdict, cleanedEnvelope.verdict_factors, ctx.config);

  return {
    ok: true,
    envelope: { ...cleanedEnvelope, verdict: finalVerdict },
    warnings,
    forced_upgrade: forcedUpgrade,
    downgraded_for_missing_factors: meta.downgraded_for_missing_factors,
  };
}

/**
 * Evaluate the predicate table (§3.0.1.B) using verdict_factors.
 * Returns the verdict the predicate table would pick, or null if no clear answer
 * (e.g., No-Go is subjective; predicate cannot infer it from factors alone).
 */
export function evaluatePredicate(
  stage: ReviewStage,
  declaredVerdict: AnyVerdict,
  f: VerdictFactors,
  config: ResolvedConfig,
): AnyVerdict | null {
  const cb = config.circuit_breakers;
  const hasIssues = f.critical_count + f.important_count > 0;

  if (stage === "design") {
    if (!hasIssues) return "Go";
    const triggersRereview =
      f.affected_major_sections_count > cb.design_mechanical_max_sections ||
      f.has_open_design_decision ||
      f.has_new_arch_concept ||
      f.has_interdependent_rc;
    if (triggersRereview) return "Rereview-after-fixes";
    if (declaredVerdict === "No-Go") return "No-Go"; // subjective; respect Codex
    return "Go-after-fixes";
  }

  if (stage === "code") {
    if (!hasIssues) return "Pass";
    const triggersRereview =
      f.touched_module_count > cb.code_mechanical_max_modules ||
      f.has_new_arch_concept ||
      f.estimated_fix_lines > cb.code_mechanical_max_fix_lines ||
      f.has_design_gap;
    if (triggersRereview) return "Rereview-after-fixes";
    if (declaredVerdict === "No-Go") return "No-Go";
    return "Pass-after-fixes";
  }

  // stage === "fix"
  const triggersRereview =
    f.touched_module_count > cb.code_mechanical_max_modules ||
    f.has_new_arch_concept ||
    f.estimated_fix_lines > cb.code_mechanical_max_fix_lines ||
    f.has_design_gap;
  if (triggersRereview) return "Rereview-after-fixes";
  // For fix, All-fixed / Partial / New-issues all rely on previous_round_resolved + claude_fix_notes
  // which the parser can't introspect from envelope alone; respect Codex.
  return declaredVerdict;
}

/** Tiebreakers per §3.0.1.F. */
export function applyTiebreakers(
  stage: ReviewStage,
  current: AnyVerdict,
  factors: VerdictFactors,
  config: ResolvedConfig,
): AnyVerdict {
  // No-Go always wins (rule: 任何 X + No-Go => No-Go).
  if (current === "No-Go") return "No-Go";
  // Rereview wins over after-fixes within the same stage.
  const expected = evaluatePredicate(stage, current, factors, config);
  if (expected === "Rereview-after-fixes" && current !== "Rereview-after-fixes") {
    return "Rereview-after-fixes";
  }
  return current;
}

/**
 * Returns true if `candidate` is more conservative than `current`, given the stage's ordering:
 *  design: Go < Go-after-fixes < Rereview-after-fixes < No-Go
 *  code:   Pass < Pass-after-fixes < Rereview-after-fixes < No-Go
 *  fix:    All-fixed < Partial < New-issues < Rereview-after-fixes < No-Go
 */
export function isMoreConservative(
  stage: ReviewStage,
  candidate: AnyVerdict,
  current: AnyVerdict,
): boolean {
  return rankOf(stage, candidate) > rankOf(stage, current);
}

function rankOf(stage: ReviewStage, v: AnyVerdict): number {
  const designOrder = ["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"];
  const codeOrder = ["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"];
  const fixOrder = [
    "All-fixed",
    "Partial",
    "New-issues",
    "Rereview-after-fixes",
    "No-Go",
  ];
  const order = stage === "design" ? designOrder : stage === "code" ? codeOrder : fixOrder;
  const idx = order.indexOf(v);
  return idx >= 0 ? idx : -1;
}

// ---------- Helpers ----------

/** Single source for the stage→verdict-schema dispatch (contract-block renders from it too). */
export function stageVerdictEnum(stage: ReviewStage) {
  if (stage === "design") return DesignVerdict;
  if (stage === "code") return CodeVerdict;
  return FixVerdict;
}

function hasAllFactors(parsed: unknown): boolean {
  const obj = (parsed as { verdict_factors?: unknown }).verdict_factors;
  return VerdictFactorsSchema.safeParse(obj).success;
}

function invalidParseContextDetail(ctx: ParseContext): string | null {
  if (ctx.designId.trim().length === 0) return "designId is empty";
  if (ctx.threadId.trim().length === 0) return "threadId is empty";
  if (ctx.reviewId.trim().length === 0) return "reviewId is empty";
  if (!Number.isInteger(ctx.reviewRound) || ctx.reviewRound < 1) {
    return `reviewRound=${ctx.reviewRound} is not a positive integer`;
  }
  if (!Number.isFinite(ctx.tokensUsedEstimate) || ctx.tokensUsedEstimate < 0) {
    return `tokensUsedEstimate=${ctx.tokensUsedEstimate} is not nonnegative`;
  }
  return null;
}

const NARROW_EXCEPTION_DANGER_KEYWORDS = [
  /\bschema\b/i,
  /\bAPI\b/,
  /\bperm(ission)?\b/i,
  /\bdepend(enc(y|ies))?\b/i,
  /\bmigration\b/i,
  /\bauth(z|n)?\b/i,
  /\bredis\s+key\b/i,
  /\bclickhouse\b/i,
  /\bpostgres\b/i,
];

function secondaryNarrowCheck(c: Conclusion): Conclusion {
  const haystack = `${c.evidence}\n${c.fix}`;
  for (const re of NARROW_EXCEPTION_DANGER_KEYWORDS) {
    if (re.test(haystack)) {
      return { ...c, auto_fix_class: "manual-only" };
    }
  }
  return c;
}

/** Synthesize a downgraded envelope when verdict_factors are malformed but other fields ok. */
function synthesizeDowngraded(
  parsed: unknown,
  ctx: ParseContext,
): ReviewEnvelope | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  // We need every reviewer-owned non-factor field for a usable record. Server-owned fields are
  // deliberately absent: ParseContext supplies real values, never placeholders.
  const required = [
    "verdict",
    "conclusions",
    "open_questions",
    "context_usage_pct",
    "compact_summary_for_round",
    "next_action",
  ];
  for (const k of required) {
    if (!(k in p)) return null;
  }
  // Build safe factors and downgraded verdict per §3.0.1.C.
  const safeFactors: VerdictFactors = {
    critical_count: 0,
    important_count: 0,
    affected_major_sections_count: 999, // forces predicate to Rereview-after-fixes
    has_open_design_decision: true,
    has_new_arch_concept: true,
    has_interdependent_rc: true,
    estimated_fix_lines: 9999,
    touched_module_count: 99,
    has_design_gap: true,
  };
  const conservativeVerdict =
    ctx.stage === "fix" && !ctx.hasPreviousRoundResolved
      ? "No-Go"
      : "Rereview-after-fixes";
  const synthesized = {
    ...p,
    verdict: conservativeVerdict,
    verdict_factors: safeFactors,
  };
  const v = ReviewStructuredPayload.safeParse(synthesized);
  if (!v.success) return null;
  return assembleEnvelope(v.data, ctx);
}

function assembleEnvelope(
  payload: ReviewStructuredPayload,
  ctx: ParseContext,
): ReviewEnvelope {
  return ReviewEnvelope.parse({
    thread_id: ctx.threadId,
    review_id: ctx.reviewId,
    design_id: ctx.designId,
    stage: ctx.stage,
    review_round: ctx.reviewRound,
    ...payload,
    tokens_used_estimate: ctx.tokensUsedEstimate,
    rejected_by_parser: [],
  });
}

function normalizeReviewerPayload(parsed: unknown): {
  payload: unknown;
  warnings: string[];
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { payload: parsed, warnings: [] };
  }
  const source = parsed as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const key of REVIEW_MODEL_OUTPUT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) payload[key] = source[key];
  }

  const normalizedContext = ContextUsagePct.safeParse(payload.context_usage_pct);
  if (normalizedContext.success) payload.context_usage_pct = normalizedContext.data;

  const warnings: string[] = [];
  if (typeof payload.compact_summary_for_round === "string") {
    const original = payload.compact_summary_for_round;
    const truncated = truncateSummary(original);
    if (truncated !== original) {
      payload.compact_summary_for_round = truncated;
      warnings.push(
        `compact_summary_for_round length=${original.length} exceeded 2000; ` +
          `server truncated it safely to ${truncated.length} without discarding findings.`,
      );
    }
  }

  if (Array.isArray(payload.conclusions)) {
    payload.conclusions = payload.conclusions.map((entry) => normalizeConclusion(entry));
  }
  return { payload, warnings };
}

function normalizeConclusion(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const conclusion = { ...(value as Record<string, unknown>) };
  if (!conclusion.target || typeof conclusion.target !== "object" || Array.isArray(conclusion.target)) {
    return conclusion;
  }
  const target = { ...(conclusion.target as Record<string, unknown>) };
  if (target.kind === "file_line") {
    if (!Object.prototype.hasOwnProperty.call(target, "missing_artifact_kind")) {
      target.missing_artifact_kind = null;
    }
    if (!Object.prototype.hasOwnProperty.call(target, "missing_artifact_path")) {
      target.missing_artifact_path = null;
    }
  } else if (target.kind === "missing_artifact") {
    if (!Object.prototype.hasOwnProperty.call(target, "file")) target.file = null;
    if (!Object.prototype.hasOwnProperty.call(target, "line")) target.line = null;
  }
  conclusion.target = target;
  return conclusion;
}

function truncateSummary(value: string): string {
  if (value.length <= 2000) return value;
  let truncated = value.slice(0, 2000);
  const final = truncated.charCodeAt(truncated.length - 1);
  if (final >= 0xd800 && final <= 0xdbff) truncated = truncated.slice(0, -1);
  return truncated;
}

function extractJsonCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  // ```json ... ``` block.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/i;
  const m = trimmed.match(fenceRe);
  if (m && m[1]?.trim().startsWith("{")) return m[1].trim();
  // First brace-balanced object in text.
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === undefined) break;
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}

function clipRaw(s: string): string {
  const max = 2000;
  if (s.length <= max) return s;
  const head = 1000;
  const tail = 1000;
  const omitted = s.length - head - tail;
  return (
    s.slice(0, head) +
    `...[${omitted} chars omitted; see raw_output for the complete local artifact]...` +
    s.slice(-tail)
  );
}
