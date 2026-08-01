// Stage-specific JSON Schema for Codex SDK structured review output.
//
// Generated from the same strict ReviewStructuredPayload Zod source the output parser validates.
// The post-pass keeps the schema inside the conservative OpenAI structured-output subset:
// remove the draft annotation and normalize literal `const` discriminators to one-value enums.

import { zodToJsonSchema } from "zod-to-json-schema";

import { stageVerdictEnum } from "./output-parser.js";
import {
  ReviewStructuredPayload,
  type ReviewStage,
} from "./types.js";

export function reviewOutputSchema(stage: ReviewStage): Record<string, unknown> {
  const stagePayload = ReviewStructuredPayload.extend({
    verdict: stageVerdictEnum(stage),
  });
  const generated = zodToJsonSchema(stagePayload, {
    target: "openAi",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete generated.$schema;
  normalizeSchemaNode(generated);
  return generated;
}

function normalizeSchemaNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeSchemaNode(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "const")) {
    record.enum = [record.const];
    delete record.const;
  }
  for (const value of Object.values(record)) normalizeSchemaNode(value);
}
