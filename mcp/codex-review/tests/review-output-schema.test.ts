import { describe, expect, it } from "vitest";

import { reviewOutputSchema } from "../src/review-output-schema.js";
import {
  REVIEW_MODEL_OUTPUT_KEYS,
  type ReviewStage,
} from "../src/types.js";

const VERDICTS: Record<ReviewStage, string[]> = {
  design: ["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"],
  code: ["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"],
  fix: ["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"],
};

function visit(node: unknown, callback: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, callback);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  callback(record);
  for (const child of Object.values(record)) visit(child, callback);
}

describe("reviewOutputSchema", () => {
  it.each(Object.keys(VERDICTS) as ReviewStage[])(
    "emits the seven model-owned keys and exact %s verdict enum",
    (stage) => {
      const schema = reviewOutputSchema(stage);
      expect(Object.keys(schema.properties as object)).toEqual([...REVIEW_MODEL_OUTPUT_KEYS]);
      expect(schema.required).toEqual([...REVIEW_MODEL_OUTPUT_KEYS]);
      const verdict = (schema.properties as Record<string, Record<string, unknown>>).verdict;
      expect(verdict?.enum).toEqual(VERDICTS[stage]);
    },
  );

  it.each(Object.keys(VERDICTS) as ReviewStage[])(
    "is recursively strict-compatible for %s",
    (stage) => {
      const schema = reviewOutputSchema(stage);
      visit(schema, (node) => {
        expect(node).not.toHaveProperty("const");
        expect(node.exclusiveMinimum).not.toBe(true);
        if (node.type === "object" && node.properties) {
          const keys = Object.keys(node.properties as object);
          expect(node.additionalProperties).toBe(false);
          expect(node.required).toEqual(keys);
        }
      });
    },
  );

  it("normalizes target discriminators to one-value enums and requires explicit null opposites", () => {
    const schema = reviewOutputSchema("code");
    const branches: Record<string, Record<string, unknown>> = {};
    visit(schema, (node) => {
      const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
      const kindEnum = properties?.kind?.enum;
      if (Array.isArray(kindEnum) && kindEnum.length === 1) {
        branches[String(kindEnum[0])] = properties;
      }
    });

    expect(Object.keys(branches).sort()).toEqual(["file_line", "missing_artifact"]);
    expect(branches.file_line?.missing_artifact_kind).toMatchObject({ type: "null" });
    expect(branches.file_line?.missing_artifact_path).toMatchObject({ type: "null" });
    expect(branches.missing_artifact?.file).toMatchObject({ type: "null" });
    expect(branches.missing_artifact?.line).toMatchObject({ type: "null" });
  });
});
