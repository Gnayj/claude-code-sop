// MCP tool handler: codex_design_review
// Spec: docs/methodology/codex-review-bridge-design.md §3.1

import { DesignReviewInput, type DesignReviewInput as DesignReviewInputT } from "../types.js";
import type { FlowDependencies, FlowResult } from "../run-review-flow.js";
import { runReviewFlow } from "../run-review-flow.js";

export const designReviewToolName = "codex_design_review";

export const designReviewToolSchema = {
  name: designReviewToolName,
  description:
    "Run a Codex design pre-review. ONLY call when claude-code-sop-collaboration.md §4.5 trigger conditions are hit.",
  inputSchema: {
    type: "object" as const,
    properties: {
      design_id: { type: "string" },
      design_doc_paths: { type: "array", items: { type: "string" } },
      task_card_path: { type: "string" },
      module_doc_paths: { type: "array", items: { type: "string" } },
      handoff_path: { type: "string" },
      triggers_hit: { type: "array", items: { type: "string" } },
      previous_round_id: { type: "string" },
      previous_round_resolved: { type: "array" },
      applied_edits: { type: "array" },
      force_new_thread: { type: "boolean" },
      manual_verdict_path: { type: "string" },
    },
    required: [
      "design_id",
      "design_doc_paths",
      "task_card_path",
      "handoff_path",
      "triggers_hit",
    ],
  },
};

export async function handleDesignReview(
  deps: FlowDependencies,
  rawInput: unknown,
): Promise<FlowResult> {
  const input: DesignReviewInputT = DesignReviewInput.parse(rawInput);
  const fileBlocks = [
    { label: "Task card", path: input.task_card_path },
    { label: "Handoff", path: input.handoff_path },
    ...(input.module_doc_paths ?? []).map((p) => ({ label: "Module doc", path: p })),
  ];
  const cb = deps.config.circuit_breakers;
  return runReviewFlow(deps, {
    stage: "design",
    designId: input.design_id,
    designDocPaths: input.design_doc_paths,
    fileBlocks,
    promptVars: {
      design_id: input.design_id,
      task_card_path: input.task_card_path,
      handoff_path: input.handoff_path,
      triggers_hit: input.triggers_hit,
      previous_round_id: input.previous_round_id ?? "",
      previous_round_resolved_json: input.previous_round_resolved
        ? JSON.stringify(input.previous_round_resolved, null, 2)
        : "",
      applied_edits_json: input.applied_edits
        ? JSON.stringify(input.applied_edits, null, 2)
        : "",
      design_mechanical_max_sections: cb.design_mechanical_max_sections,
      code_mechanical_max_fix_lines: cb.code_mechanical_max_fix_lines,
      code_mechanical_max_modules: cb.code_mechanical_max_modules,
    },
    hasPreviousRoundResolved:
      Array.isArray(input.previous_round_resolved) &&
      input.previous_round_resolved.length > 0,
    forceNewThread: input.force_new_thread === true,
    manualVerdictPath: input.manual_verdict_path,
  });
}
