import { describe, expect, it } from "vitest";
import { ZodEffects, ZodEnum, ZodString, type ZodTypeAny } from "zod";

import { renderContractBlock } from "../src/contract-block.js";
import { stageVerdictEnum } from "../src/output-parser.js";
import {
  ReviewStructuredPayload,
  SERVER_OWNED_ENVELOPE_KEYS,
  StructuredConclusion,
  VERDICT_FACTOR_KEYS,
  VerdictFactors,
  type ReviewStage,
} from "../src/types.js";

// Local pin: schema evolution must consciously update this list (the sync guard).
const PAYLOAD_KEYS = [
  "verdict",
  "verdict_factors",
  "conclusions",
  "open_questions",
  "context_usage_pct",
  "compact_summary_for_round",
  "next_action",
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
      `## [bridge-authoritative] Reviewer payload contract (stage=${stage})`,
    );
    expect(block).toContain("AUTHORITATIVE");
    expect(block).toContain("same Zod");
    expect(block).toContain("this block wins");
  });

  it.each(CASES)(
    "contains every ReviewStructuredPayload top-level key and names server-owned exclusions for $stage",
    ({ stage }) => {
      const block = renderContractBlock(stage);
      const schemaKeys = Object.keys(ReviewStructuredPayload.shape);
      expect(schemaKeys).toEqual(PAYLOAD_KEYS);
      for (const key of schemaKeys) {
        expect(block).toContain(`\`${key}\``);
      }
      for (const key of SERVER_OWNED_ENVELOPE_KEYS) {
        expect(block).toContain(`\`${key}\``);
      }
      expect(block).toContain("do NOT emit");
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

  it("renders schema-derived reviewer-payload value constraints", () => {
    const block = renderContractBlock("design");
    const nextAction = unwrapSchema(ReviewStructuredPayload.shape.next_action);
    const autoFixClass = unwrapSchema(StructuredConclusion.shape.auto_fix_class);
    const compactSummary = unwrapSchema(
      ReviewStructuredPayload.shape.compact_summary_for_round,
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
    expect(block).toContain("`missing_artifact_kind` and `missing_artifact_path` must both be `null`");
    expect(block).toContain("`file` and `line` must both be `null`");
  });
});
