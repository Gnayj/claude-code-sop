import { describe, expect, it } from "vitest";
import {
  applyTiebreakers,
  evaluatePredicate,
  isMoreConservative,
  parseCodexOutput,
} from "../src/output-parser.js";
import type { ReviewStage } from "../src/types.js";
import {
  defaultConfig,
  defaultFactors,
  makeConclusion,
  makeEnvelope,
  makeReviewerPayload,
} from "./test-helpers.js";

const cfg = defaultConfig();

function ctx(stage: ReviewStage, hasPrevResolved = true) {
  return {
    stage,
    config: cfg,
    hasPreviousRoundResolved: hasPrevResolved,
    designId: "server-design",
    threadId: "server-thread",
    reviewId: "server-review",
    reviewRound: 7,
    tokensUsedEstimate: 4321,
  };
}

describe("a) danger verb filter + fail-closed + Suggestion auto_fix_class secondary check", () => {
  it("rejects conclusion whose fix text matches danger verb regex", () => {
    const env = makeEnvelope("code", "Pass-after-fixes", {
      verdict_factors: defaultFactors({ critical_count: 0, important_count: 1 }),
      conclusions: [
        makeConclusion("Important", { fix: "run `git push origin main` to deploy" }),
        makeConclusion("Important", { fix: "harmless suggestion" }),
      ],
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.conclusions.length).toBe(1);
    expect(result.envelope.rejected_by_parser.length).toBe(1);
    expect(result.envelope.rejected_by_parser[0]?.reason).toBe("tool_violation");
  });

  it("forces auto_fix_class=auto Suggestion to manual-only on schema/api keyword", () => {
    const env = makeEnvelope("code", "Pass", {
      conclusions: [
        makeConclusion("Suggestion", {
          auto_fix_class: "auto",
          evidence: "consider updating the schema fields here",
          fix: "rename column `foo` to `foo_v2` in the schema",
        }),
      ],
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.conclusions[0]?.auto_fix_class).toBe("manual-only");
  });

  it("non_json input fails closed", () => {
    const result = parseCodexOutput("not a json at all", ctx("design"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("non_json");
  });

  it("tolerates ```json fence wrapping", () => {
    const env = makeEnvelope("design", "Go");
    const wrapped = "```json\n" + JSON.stringify(env) + "\n```";
    const result = parseCodexOutput(wrapped, ctx("design"));
    expect(result.ok).toBe(true);
  });
});

describe("b) old verdict enum rejection", () => {
  const oldEnums = [
    "Go-with-required-changes",
    "Critical-must-fix",
    "Important-should-fix",
    "Suggestion-only",
  ];
  for (const old of oldEnums) {
    it(`rejects "${old}"`, () => {
      const raw = JSON.stringify({ ...makeEnvelope("design", "Go"), verdict: old });
      const result = parseCodexOutput(raw, ctx("design"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("old_verdict_rejected");
    });
  }
});

describe("c) verdict_factors 9 fields required — missing -> conservative downgrade", () => {
  const factorKeys = [
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

  for (const key of factorKeys) {
    it(`design: missing "${key}" -> Rereview-after-fixes`, () => {
      const env = makeEnvelope("design", "Go-after-fixes", {
        verdict_factors: defaultFactors({ critical_count: 1 }),
      });
      const factorsAny = env.verdict_factors as Record<string, unknown>;
      delete factorsAny[key];
      const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.envelope.verdict).toBe("Rereview-after-fixes");
      expect(result.downgraded_for_missing_factors).toBe(true);
    });
  }

  it("fix: missing field + no previous_round_resolved -> No-Go", () => {
    const env = makeEnvelope("fix", "All-fixed", {
      verdict_factors: defaultFactors({ critical_count: 0 }),
    });
    const factorsAny = env.verdict_factors as Record<string, unknown>;
    delete factorsAny["has_design_gap"];
    const result = parseCodexOutput(JSON.stringify(env), ctx("fix", false));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("No-Go");
  });

  it.each([
    ["critical_count", false],
    ["has_design_gap", 0],
  ])("wrong factor type %s=%j also triggers conservative downgrade", (key, value) => {
    const env = makeEnvelope("code", "Pass");
    (env.verdict_factors as unknown as Record<string, unknown>)[key] = value;
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.downgraded_for_missing_factors).toBe(true);
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });
});

describe("d) verdict <-> verdict_factors consistency: force-upgrade", () => {
  it("design: declared Go-after-fixes but has_new_arch_concept=true -> upgrade Rereview-after-fixes", () => {
    const env = makeEnvelope("design", "Go-after-fixes", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        has_new_arch_concept: true,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
    expect(result.forced_upgrade).toBe(true);
  });

  it("design: declared Go-after-fixes but affected_major_sections_count=9 -> upgrade", () => {
    const env = makeEnvelope("design", "Go-after-fixes", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        affected_major_sections_count: 9,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("design: declared Go-after-fixes but has_open_design_decision=true -> upgrade", () => {
    const env = makeEnvelope("design", "Go-after-fixes", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        has_open_design_decision: true,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("design: declared Go-after-fixes but has_interdependent_rc=true -> upgrade", () => {
    const env = makeEnvelope("design", "Go-after-fixes", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        has_interdependent_rc: true,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("code: declared Pass-after-fixes but touched_module_count=2 -> upgrade", () => {
    const env = makeEnvelope("code", "Pass-after-fixes", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        touched_module_count: 2,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("code: declared Pass-after-fixes but has_new_arch_concept=true -> upgrade", () => {
    const env = makeEnvelope("code", "Pass-after-fixes", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        has_new_arch_concept: true,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("code: declared Pass-after-fixes but estimated_fix_lines=101 -> upgrade", () => {
    const env = makeEnvelope("code", "Pass-after-fixes", {
      verdict_factors: defaultFactors({
        important_count: 1,
        estimated_fix_lines: 101,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("code: declared Pass-after-fixes but has_design_gap=true -> upgrade", () => {
    const env = makeEnvelope("code", "Pass-after-fixes", {
      verdict_factors: defaultFactors({
        important_count: 1,
        has_design_gap: true,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("design: factors-consistent Go-after-fixes stays as-is", () => {
    const env = makeEnvelope("design", "Go-after-fixes", {
      verdict_factors: defaultFactors({
        important_count: 2,
        affected_major_sections_count: 1,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Go-after-fixes");
    expect(result.forced_upgrade).toBe(false);
  });

  it("code: factors-consistent Pass stays Pass", () => {
    const env = makeEnvelope("code", "Pass");
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Pass");
    expect(result.forced_upgrade).toBe(false);
  });

  it("fix: declared All-fixed but touched_module_count=2 -> upgrade Rereview-after-fixes", () => {
    const env = makeEnvelope("fix", "All-fixed", {
      verdict_factors: defaultFactors({ touched_module_count: 2 }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("fix", true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });

  it("fix: declared New-issues but has_design_gap=true -> upgrade", () => {
    const env = makeEnvelope("fix", "New-issues", {
      verdict_factors: defaultFactors({
        critical_count: 1,
        has_design_gap: true,
      }),
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("fix", true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });
});

describe("e) target.kind: file_line | missing_artifact (二选一)", () => {
  it("file_line target accepted", () => {
    const env = makeEnvelope("code", "Pass", {
      conclusions: [
        makeConclusion("Suggestion", {
          target: { kind: "file_line", file: "src/x.ts", line: 1 },
        }),
      ],
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
  });

  it("missing_artifact (test) accepted", () => {
    const env = makeEnvelope("code", "Pass", {
      conclusions: [
        makeConclusion("Suggestion", {
          target: {
            kind: "missing_artifact",
            missing_artifact_kind: "test",
            missing_artifact_path: "tests/foo.test.ts",
          },
        }),
      ],
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
  });

  for (const kind of ["test", "config", "doc", "module"] as const) {
    it(`missing_artifact_kind="${kind}" accepted`, () => {
      const env = makeEnvelope("code", "Pass", {
        conclusions: [
          makeConclusion("Suggestion", {
            target: {
              kind: "missing_artifact",
              missing_artifact_kind: kind,
              missing_artifact_path: `path/to/${kind}`,
            },
          }),
        ],
      });
      const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
      expect(result.ok).toBe(true);
    });
  }

  it("rejects target with neither file_line nor missing_artifact_kind", () => {
    const env = makeEnvelope("code", "Pass") as unknown as Record<string, unknown>;
    env.conclusions = [
      {
        ...makeConclusion("Suggestion"),
        target: { kind: "broken", file: null, line: null },
      },
    ];
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_violation");
  });
});

describe("e2) server-authoritative fields omitted by Codex", () => {
  it("parses ok when Codex omits thread_id (server overrides it post-parse)", () => {
    const env = makeEnvelope("code", "Pass") as unknown as Record<string, unknown>;
    delete env.thread_id;
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.thread_id).toBe("server-thread");
  });

  it("parses ok when Codex omits review_id", () => {
    const env = makeEnvelope("design", "Go") as unknown as Record<string, unknown>;
    delete env.review_id;
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.review_id).toBe("server-review");
  });

  it("parses ok when Codex omits both thread_id and review_id", () => {
    const env = makeEnvelope("code", "Pass-after-fixes", {
      verdict_factors: defaultFactors({ critical_count: 1 }),
      conclusions: [makeConclusion("Critical")],
    }) as unknown as Record<string, unknown>;
    delete env.thread_id;
    delete env.review_id;
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
  });

  it("overrides every server-owned field, including malformed legacy values", () => {
    const env = makeEnvelope("code", "Pass") as unknown as Record<string, unknown>;
    Object.assign(env, {
      thread_id: false,
      review_id: null,
      design_id: "model-design",
      stage: "fix",
      review_round: -9,
      tokens_used_estimate: "many",
      rejected_by_parser: false,
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope).toMatchObject({
      thread_id: "server-thread",
      review_id: "server-review",
      design_id: "server-design",
      stage: "code",
      review_round: 7,
      tokens_used_estimate: 4321,
      rejected_by_parser: [],
    });
  });

  it("still rejects when a reviewer-owned field is missing", () => {
    const env = makeEnvelope("code", "Pass") as unknown as Record<string, unknown>;
    delete env.open_questions;
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_violation");
  });

  it("synthesizes a downgraded envelope when factors malformed AND thread_id omitted", () => {
    const env = makeEnvelope("design", "Go") as unknown as Record<string, unknown>;
    delete env.thread_id;
    env.verdict_factors = { critical_count: "bad" };
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.downgraded_for_missing_factors).toBe(true);
    expect(result.envelope.verdict).toBe("Rereview-after-fixes");
  });
});

describe("e3) auxiliary drift recovery keeps review substance", () => {
  it("parses the primary bare seven-key reviewer payload and assembles runtime fields", () => {
    const payload = makeReviewerPayload("code", "Pass", {
      conclusions: [makeConclusion("Suggestion", { conclusion_id: "primary-seven" })],
    });
    expect(Object.keys(payload)).toHaveLength(7);
    const result = parseCodexOutput(JSON.stringify(payload), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope).toMatchObject({
      thread_id: "server-thread",
      review_id: "server-review",
      design_id: "server-design",
      stage: "code",
      review_round: 7,
      tokens_used_estimate: 4321,
    });
    expect(result.envelope.conclusions[0]?.conclusion_id).toBe("primary-seven");
  });

  it("returns a parser failure instead of throwing when runtime thread id is unavailable", () => {
    const result = parseCodexOutput(
      JSON.stringify(makeReviewerPayload("code", "Pass")),
      { ...ctx("code"), threadId: "" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_violation");
    expect(result.detail).toContain("threadId is empty");
  });

  it("accepts the v0.2.15 rejected_by_parser boolean drift without losing findings", () => {
    const conclusions = Array.from({ length: 6 }, (_, index) =>
      makeConclusion("Suggestion", { conclusion_id: `finding-${index + 1}` }),
    );
    const env = makeEnvelope("code", "Pass", {
      conclusions,
      rejected_by_parser: false as never,
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.conclusions.map((item) => item.conclusion_id)).toEqual(
      conclusions.map((item) => item.conclusion_id),
    );
    expect(result.envelope.rejected_by_parser).toEqual([]);
  });

  it("truncates an oversized summary and preserves all conclusions", () => {
    const env = makeEnvelope("design", "Go", {
      compact_summary_for_round: "x".repeat(2500),
      conclusions: [
        makeConclusion("Suggestion", { conclusion_id: "first" }),
        makeConclusion("Suggestion", { conclusion_id: "second" }),
      ],
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.compact_summary_for_round).toHaveLength(2000);
    expect(result.envelope.conclusions).toHaveLength(2);
    expect(result.warnings.join("\n")).toContain("server truncated it safely");
  });

  it("does not leave a lone high surrogate at the summary boundary", () => {
    const env = makeEnvelope("design", "Go", {
      compact_summary_for_round: "x".repeat(1999) + "😀" + "tail",
    });
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = result.envelope.compact_summary_for_round;
    expect(summary).toHaveLength(1999);
    expect(summary.charCodeAt(summary.length - 1)).not.toBeGreaterThanOrEqual(0xd800);
  });

  it("shows both head and tail when a parser failure is clipped", () => {
    const raw = JSON.stringify({
      verdict: "Pass",
      verdict_factors: defaultFactors(),
      conclusions: [],
      open_questions: [],
      context_usage_pct: 0,
      compact_summary_for_round: "head-marker-" + "x".repeat(2500) + "-tail-marker",
      // next_action intentionally omitted so the post-normalization schema rejects it.
    });
    const result = parseCodexOutput(raw, ctx("code"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.raw_excerpt).toContain("head-marker");
    expect(result.raw_excerpt).toContain("tail-marker");
    expect(result.raw_excerpt).toContain("chars omitted");
  });
});

describe("f) predicate evaluation — full path coverage", () => {
  // design
  it("design Go: zero issues", () => {
    expect(evaluatePredicate("design", "Go", defaultFactors(), cfg)).toBe("Go");
  });
  it("design Go-after-fixes: issues + all bool false + sections <= 8", () => {
    expect(
      evaluatePredicate(
        "design",
        "Go-after-fixes",
        defaultFactors({ critical_count: 1, affected_major_sections_count: 5 }),
        cfg,
      ),
    ).toBe("Go-after-fixes");
  });
  it("design Rereview when sections > threshold", () => {
    expect(
      evaluatePredicate(
        "design",
        "Go-after-fixes",
        defaultFactors({ critical_count: 1, affected_major_sections_count: 9 }),
        cfg,
      ),
    ).toBe("Rereview-after-fixes");
  });
  // code
  it("code Pass: zero issues", () => {
    expect(evaluatePredicate("code", "Pass", defaultFactors(), cfg)).toBe("Pass");
  });
  it("code Pass-after-fixes: small + same module + no arch", () => {
    expect(
      evaluatePredicate(
        "code",
        "Pass-after-fixes",
        defaultFactors({
          important_count: 1,
          touched_module_count: 1,
          estimated_fix_lines: 50,
        }),
        cfg,
      ),
    ).toBe("Pass-after-fixes");
  });
  it("code Rereview when modules > 1", () => {
    expect(
      evaluatePredicate(
        "code",
        "Pass-after-fixes",
        defaultFactors({ critical_count: 1, touched_module_count: 2 }),
        cfg,
      ),
    ).toBe("Rereview-after-fixes");
  });
  // fix
  it("fix respects Codex's All-fixed when no rereview triggers", () => {
    expect(
      evaluatePredicate("fix", "All-fixed", defaultFactors(), cfg),
    ).toBe("All-fixed");
  });
  it("fix forced Rereview when touched_module_count=2", () => {
    expect(
      evaluatePredicate(
        "fix",
        "All-fixed",
        defaultFactors({ touched_module_count: 2 }),
        cfg,
      ),
    ).toBe("Rereview-after-fixes");
  });
});

describe("g) tiebreaker matrix (§3.0.1.F)", () => {
  it("any X + No-Go => No-Go", () => {
    expect(applyTiebreakers("design", "No-Go", defaultFactors(), cfg)).toBe("No-Go");
    expect(applyTiebreakers("code", "No-Go", defaultFactors(), cfg)).toBe("No-Go");
    expect(applyTiebreakers("fix", "No-Go", defaultFactors(), cfg)).toBe("No-Go");
  });

  it("Go-after-fixes + factors-imply-Rereview => Rereview-after-fixes", () => {
    const out = applyTiebreakers(
      "design",
      "Go-after-fixes",
      defaultFactors({ critical_count: 1, has_new_arch_concept: true }),
      cfg,
    );
    expect(out).toBe("Rereview-after-fixes");
  });

  it("Pass-after-fixes + factors-imply-Rereview => Rereview-after-fixes", () => {
    const out = applyTiebreakers(
      "code",
      "Pass-after-fixes",
      defaultFactors({ critical_count: 1, has_design_gap: true }),
      cfg,
    );
    expect(out).toBe("Rereview-after-fixes");
  });

  it("isMoreConservative ordering — design", () => {
    expect(isMoreConservative("design", "Go-after-fixes", "Go")).toBe(true);
    expect(isMoreConservative("design", "Rereview-after-fixes", "Go-after-fixes")).toBe(true);
    expect(isMoreConservative("design", "No-Go", "Rereview-after-fixes")).toBe(true);
    expect(isMoreConservative("design", "Go", "Rereview-after-fixes")).toBe(false);
  });

  it("isMoreConservative ordering — fix (Partial > New-issues per §3.0.1.F)", () => {
    // Note: tiebreaker says Partial+New-issues => Partial. In our rank order, Partial < New-issues
    // (rank 1 vs 2). The tiebreaker rule is enforced inside applyTiebreakers, not isMoreConservative.
    expect(isMoreConservative("fix", "New-issues", "Partial")).toBe(true);
  });
});

describe("k) context_usage_pct 百分数容忍(coerce >1 → /100,不拒整 envelope)", () => {
  it("Codex 发百分数 35 → parse ok 且归一为 0.35", () => {
    const env = { ...makeEnvelope("fix", "All-fixed"), context_usage_pct: 35 };
    const result = parseCodexOutput(JSON.stringify(env), ctx("fix"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.context_usage_pct).toBeCloseTo(0.35, 6);
  });

  it("正常分数 0.66 保持不变", () => {
    const env = { ...makeEnvelope("code", "Pass"), context_usage_pct: 0.66 };
    const result = parseCodexOutput(JSON.stringify(env), ctx("code"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.context_usage_pct).toBeCloseTo(0.66, 6);
  });

  it("异常上界 >100 → clamp 到 1(不 reject)", () => {
    const env = { ...makeEnvelope("design", "Go"), context_usage_pct: 150 };
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.context_usage_pct).toBe(1);
  });

  it("边界 1.0 保持(不当百分数)", () => {
    const env = { ...makeEnvelope("design", "Go"), context_usage_pct: 1 };
    const result = parseCodexOutput(JSON.stringify(env), ctx("design"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.context_usage_pct).toBe(1);
  });
});
