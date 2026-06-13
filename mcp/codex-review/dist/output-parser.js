// Codex output parser: schema validation + predicate evaluation + force-upgrade + tiebreaker.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §3.0.1 (A/B/C/D/E/F/G)
//   §6.1.2: output-parser fail-closed danger-verb filter
//   §15.7  M2: 9-factor required, missing -> conservative downgrade
//   §15.7  M3: target.kind = file_line | missing_artifact (二选一)
//   §15.8  D3: NO exception to conservative downgrade
import { effectiveDangerVerbsRegex } from "./safety.js";
import { DesignVerdict, CodeVerdict, FixVerdict, REJECTED_OLD_VERDICTS, CodexEmittedEnvelope, VERDICT_FACTOR_KEYS, } from "./types.js";
// ---------- Main entry ----------
export function parseCodexOutput(rawText, ctx) {
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
    let parsed;
    try {
        parsed = JSON.parse(candidate);
    }
    catch (err) {
        return {
            ok: false,
            reason: "non_json",
            detail: `JSON parse error: ${err.message}`,
            raw_excerpt: clipRaw(candidate),
        };
    }
    // 2) Reject old verdict enums (§3.0.1.G.1).
    const candidateVerdict = parsed.verdict;
    if (typeof candidateVerdict === "string" &&
        REJECTED_OLD_VERDICTS.has(candidateVerdict)) {
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
    if (!stageVerdictSchema.options.includes(candidateVerdict)) {
        return {
            ok: false,
            reason: "stage_verdict_mismatch",
            detail: `verdict="${candidateVerdict}" not allowed for stage=${ctx.stage}; expected one of ${stageVerdictSchema.options.join(", ")}`,
            raw_excerpt: clipRaw(candidate),
        };
    }
    // 4) verdict_factors check — track missing fields explicitly (do not let zod abort early).
    const downgradeForMissing = !hasAllFactors(parsed);
    // 5) Schema-validate full envelope (will use whatever factors are present).
    //    Use the parse-stage schema: thread_id / review_id are server-authoritative
    //    and overridden post-parse, so their omission must not reject the review.
    const validation = CodexEmittedEnvelope.safeParse(parsed);
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
        const synth = synthesizeDowngraded(parsed, ctx);
        if (synth === null) {
            return {
                ok: false,
                reason: "schema_violation",
                detail: "verdict_factors malformed AND core envelope fields invalid: " +
                    validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
                raw_excerpt: clipRaw(candidate),
            };
        }
        return finishWithUpgrades(synth, ctx, {
            warnings: [
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
    return finishWithUpgrades(validation.data, ctx, {
        warnings: [],
        downgraded_for_missing_factors: false,
    });
}
// ---------- Predicate evaluation + force-upgrade + tiebreaker ----------
function finishWithUpgrades(envelope, ctx, meta) {
    const warnings = [...meta.warnings];
    // a) Reject conclusions whose target is malformed (already caught by zod for the discriminated union),
    //    but verify file_line vs missing_artifact mutual exclusion semantics + dangerous fix-text.
    const dangerRe = effectiveDangerVerbsRegex(ctx.config);
    const filteredConclusions = [];
    const rejectedAdditions = [];
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
                warnings.push(`Suggestion ${c.conclusion_id} forced to manual-only (narrow-exception keyword hit).`);
            }
        }
        else {
            filteredConclusions.push(c);
        }
    }
    const cleanedEnvelope = {
        ...envelope,
        conclusions: filteredConclusions,
        rejected_by_parser: [...envelope.rejected_by_parser, ...rejectedAdditions],
    };
    // b) Predicate evaluation.
    const expected = evaluatePredicate(ctx.stage, cleanedEnvelope.verdict, cleanedEnvelope.verdict_factors, ctx.config);
    let finalVerdict = cleanedEnvelope.verdict;
    let forcedUpgrade = false;
    if (expected !== null && isMoreConservative(ctx.stage, expected, finalVerdict)) {
        forcedUpgrade = true;
        warnings.push(`verdict="${finalVerdict}" inconsistent with verdict_factors; forced to "${expected}" per §3.0.1.G.3.`);
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
export function evaluatePredicate(stage, declaredVerdict, f, config) {
    const cb = config.circuit_breakers;
    const hasIssues = f.critical_count + f.important_count > 0;
    if (stage === "design") {
        if (!hasIssues)
            return "Go";
        const triggersRereview = f.affected_major_sections_count > cb.design_mechanical_max_sections ||
            f.has_open_design_decision ||
            f.has_new_arch_concept ||
            f.has_interdependent_rc;
        if (triggersRereview)
            return "Rereview-after-fixes";
        if (declaredVerdict === "No-Go")
            return "No-Go"; // subjective; respect Codex
        return "Go-after-fixes";
    }
    if (stage === "code") {
        if (!hasIssues)
            return "Pass";
        const triggersRereview = f.touched_module_count > cb.code_mechanical_max_modules ||
            f.has_new_arch_concept ||
            f.estimated_fix_lines > cb.code_mechanical_max_fix_lines ||
            f.has_design_gap;
        if (triggersRereview)
            return "Rereview-after-fixes";
        if (declaredVerdict === "No-Go")
            return "No-Go";
        return "Pass-after-fixes";
    }
    // stage === "fix"
    const triggersRereview = f.touched_module_count > cb.code_mechanical_max_modules ||
        f.has_new_arch_concept ||
        f.estimated_fix_lines > cb.code_mechanical_max_fix_lines ||
        f.has_design_gap;
    if (triggersRereview)
        return "Rereview-after-fixes";
    // For fix, All-fixed / Partial / New-issues all rely on previous_round_resolved + claude_fix_notes
    // which the parser can't introspect from envelope alone; respect Codex.
    return declaredVerdict;
}
/** Tiebreakers per §3.0.1.F. */
export function applyTiebreakers(stage, current, factors, config) {
    // No-Go always wins (rule: 任何 X + No-Go => No-Go).
    if (current === "No-Go")
        return "No-Go";
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
export function isMoreConservative(stage, candidate, current) {
    return rankOf(stage, candidate) > rankOf(stage, current);
}
function rankOf(stage, v) {
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
function stageVerdictEnum(stage) {
    if (stage === "design")
        return DesignVerdict;
    if (stage === "code")
        return CodeVerdict;
    return FixVerdict;
}
function hasAllFactors(parsed) {
    const obj = parsed.verdict_factors;
    if (!obj || typeof obj !== "object")
        return false;
    for (const key of VERDICT_FACTOR_KEYS) {
        if (!(key in obj))
            return false;
        const val = obj[key];
        if (typeof val === "boolean")
            continue;
        if (typeof val === "number" && Number.isFinite(val) && val >= 0)
            continue;
        return false;
    }
    return true;
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
function secondaryNarrowCheck(c) {
    const haystack = `${c.evidence}\n${c.fix}`;
    for (const re of NARROW_EXCEPTION_DANGER_KEYWORDS) {
        if (re.test(haystack)) {
            return { ...c, auto_fix_class: "manual-only" };
        }
    }
    return c;
}
/** Synthesize a downgraded envelope when verdict_factors are malformed but other fields ok. */
function synthesizeDowngraded(parsed, ctx) {
    if (!parsed || typeof parsed !== "object")
        return null;
    const p = parsed;
    // We need at least the non-factor scalar fields for a usable record.
    // thread_id / review_id are server-authoritative (filled post-parse), so they
    // are not required here — CodexEmittedEnvelope supplies a placeholder default.
    const required = [
        "design_id",
        "stage",
        "review_round",
        "verdict",
        "conclusions",
        "open_questions",
        "tokens_used_estimate",
        "context_usage_pct",
        "compact_summary_for_round",
        "next_action",
        "rejected_by_parser",
    ];
    for (const k of required) {
        if (!(k in p))
            return null;
    }
    // Build safe factors and downgraded verdict per §3.0.1.C.
    const safeFactors = {
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
    const conservativeVerdict = ctx.stage === "fix" && !ctx.hasPreviousRoundResolved
        ? "No-Go"
        : "Rereview-after-fixes";
    const synthesized = {
        ...p,
        verdict: conservativeVerdict,
        verdict_factors: safeFactors,
    };
    const v = CodexEmittedEnvelope.safeParse(synthesized);
    if (!v.success)
        return null;
    return v.data;
}
function extractJsonCandidate(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{"))
        return trimmed;
    // ```json ... ``` block.
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/i;
    const m = trimmed.match(fenceRe);
    if (m && m[1]?.trim().startsWith("{"))
        return m[1].trim();
    // First brace-balanced object in text.
    const start = trimmed.indexOf("{");
    if (start < 0)
        return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === undefined)
            break;
        if (inStr) {
            if (esc) {
                esc = false;
            }
            else if (ch === "\\") {
                esc = true;
            }
            else if (ch === '"') {
                inStr = false;
            }
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === "{")
            depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0)
                return trimmed.slice(start, i + 1);
        }
    }
    return null;
}
function clipRaw(s) {
    if (s.length <= 800)
        return s;
    return s.slice(0, 800) + "...[clipped]";
}
//# sourceMappingURL=output-parser.js.map