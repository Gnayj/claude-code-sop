import { describe, expect, it } from "vitest";
import { ZodEffects, ZodEnum, ZodString, type ZodTypeAny } from "zod";

import { renderContractBlock } from "../src/contract-block.js";
import { stageVerdictEnum } from "../src/output-parser.js";
import {
  Conclusion,
  ReviewEnvelope,
  VERDICT_FACTOR_KEYS,
  VerdictFactors,
  type ReviewStage,
} from "../src/types.js";

// Local pin: schema evolution must consciously update this list (the sync guard).
const ENVELOPE_KEYS = [
  "thread_id",
  "review_id",
  "design_id",
  "stage",
  "review_round",
  "verdict",
  "verdict_factors",
  "conclusions",
  "open_questions",
  "tokens_used_estimate",
  "context_usage_pct",
  "compact_summary_for_round",
  "next_action",
  "rejected_by_parser",
];

const CASES: Array<{ stage: ReviewStage; expectedVerdicts: readonly string[] }> = [
  {
    stage: "design",
    expectedVerdicts: ["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"],
  },
  {
    stage: "code",
    expectedVerdicts: ["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"],
  },
  {
    stage: "fix",
    expectedVerdicts: [
      "All-fixed",
      "Partial",
      "New-issues",
      "Rereview-after-fixes",
      "No-Go",
    ],
  },
];

function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  while (true) {
    if (current instanceof ZodEffects) {
      current = current.innerType();
    } else if ("unwrap" in current && typeof current.unwrap === "function") {
      current = current.unwrap() as ZodTypeAny;
    } else {
      return current;
    }
  }
}

describe("renderContractBlock Zod synchronization", () => {
  it.each(CASES)("renders the authoritative banner for $stage", ({ stage }) => {
    const block = renderContractBlock(stage);

    expect(block).toContain(
      `## [bridge-authoritative] Envelope contract (stage=${stage})`,
    );
    expect(block).toContain("AUTHORITATIVE");
    expect(block).toContain("same Zod");
    expect(block).toContain("this block wins");
  });

  it.each(CASES)(
    "contains every ReviewEnvelope top-level key for $stage",
    ({ stage }) => {
      const block = renderContractBlock(stage);
      const schemaKeys = Object.keys(ReviewEnvelope.shape);
      expect(schemaKeys).toEqual(ENVELOPE_KEYS);
      for (const key of schemaKeys) {
        expect(block).toContain(`\`${key}\``);
      }
    },
  );

  it.each(CASES)(
    "contains every legal $stage verdict",
    ({ stage, expectedVerdicts }) => {
      // Pin the parser's dispatch (the block renders from stageVerdictEnum directly).
      expect(stageVerdictEnum(stage).options).toEqual(expectedVerdicts);
      const block = renderContractBlock(stage);
      for (const verdict of expectedVerdicts) {
        expect(block).toContain(`\`${verdict}\``);
      }
    },
  );

  it.each(CASES)(
    "contains every verdict_factors field for $stage",
    ({ stage }) => {
      const block = renderContractBlock(stage);
      const factorKeys = Object.keys(VerdictFactors.shape);
      expect(factorKeys).toEqual([...VERDICT_FACTOR_KEYS]);
      for (const key of factorKeys) {
        expect(block).toContain(`\`${key}\``);
      }
    },
  );

  it("renders schema-derived envelope value constraints", () => {
    const block = renderContractBlock("design");
    const nextAction = unwrapSchema(ReviewEnvelope.shape.next_action);
    const autoFixClass = unwrapSchema(Conclusion.shape.auto_fix_class);
    const compactSummary = unwrapSchema(
      ReviewEnvelope.shape.compact_summary_for_round,
    );

    expect(nextAction).toBeInstanceOf(ZodEnum);
    expect(autoFixClass).toBeInstanceOf(ZodEnum);
    expect(compactSummary).toBeInstanceOf(ZodString);
    if (
      !(nextAction instanceof ZodEnum) ||
      !(autoFixClass instanceof ZodEnum) ||
      !(compactSummary instanceof ZodString)
    ) {
      throw new Error("Expected enum and string envelope schemas");
    }

    for (const action of nextAction.options) {
      expect(block).toContain(`\`${action}\``);
    }
    for (const fixClass of autoFixClass.options) {
      expect(block).toContain(`\`${fixClass}\``);
    }

    const maxCheck = compactSummary._def.checks.find(
      (check) => check.kind === "max",
    );
    expect(maxCheck?.kind).toBe("max");
    if (maxCheck?.kind === "max") {
      expect(block).toContain(String(maxCheck.value));
    }
  });
});
