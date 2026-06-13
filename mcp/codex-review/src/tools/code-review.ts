// MCP tool handler: codex_code_review
// Spec: docs/methodology/codex-review-bridge-design.md §3.2

import { CodeReviewInput, type CodeReviewInput as CodeReviewInputT } from "../types.js";
import type { FlowDependencies, FlowResult } from "../run-review-flow.js";
import { runReviewFlow } from "../run-review-flow.js";

export const codeReviewToolName = "codex_code_review";

export const codeReviewToolSchema = {
  name: codeReviewToolName,
  description:
    "Run a Codex code review on the implement diff. Verdict ∈ {Pass, Pass-after-fixes, Rereview-after-fixes, No-Go}.",
  inputSchema: {
    type: "object" as const,
    properties: {
      design_id: { type: "string" },
      task_card_path: { type: "string" },
      design_doc_paths: { type: "array", items: { type: "string" } },
      module_doc_paths: { type: "array", items: { type: "string" } },
      handoff_path: { type: "string" },
      diff_spec: { type: "string" },
      changed_files: { type: "array", items: { type: "string" } },
      claude_output: { type: "object" },
      tests_run: { type: "array", items: { type: "string" } },
      validation_evidence: { type: "string" },
      docs_updated: { type: "array", items: { type: "string" } },
      previous_round_id: { type: "string" },
      previous_round_resolved: { type: "array" },
      applied_fixes: { type: "array" },
      force_new_thread: { type: "boolean" },
      manual_verdict_path: { type: "string" },
    },
    required: [
      "design_id",
      "task_card_path",
      "design_doc_paths",
      "handoff_path",
      "diff_spec",
      "changed_files",
      "claude_output",
      "tests_run",
      "validation_evidence",
      "docs_updated",
    ],
  },
};

export async function handleCodeReview(
  deps: FlowDependencies,
  rawInput: unknown,
): Promise<FlowResult> {
  const input: CodeReviewInputT = CodeReviewInput.parse(rawInput);
  const fileBlocks = [
    { label: "Task card", path: input.task_card_path },
    { label: "Handoff", path: input.handoff_path },
    ...(input.module_doc_paths ?? []).map((p) => ({ label: "Module doc", path: p })),
  ];
  const cb = deps.config.circuit_breakers;
  return runReviewFlow(deps, {
    stage: "code",
    designId: input.design_id,
    designDocPaths: input.design_doc_paths,
    fileBlocks,
    promptVars: {
      design_id: input.design_id,
      task_card_path: input.task_card_path,
      handoff_path: input.handoff_path,
      diff_spec: input.diff_spec,
      changed_files: input.changed_files,
      claude_output_json: JSON.stringify(input.claude_output, null, 2),
      tests_run: input.tests_run,
      validation_evidence: input.validation_evidence,
      docs_updated: input.docs_updated,
      previous_round_id: input.previous_round_id ?? "",
      previous_round_resolved_json: input.previous_round_resolved
        ? JSON.stringify(input.previous_round_resolved, null, 2)
        : "",
      applied_fixes_json: input.applied_fixes
        ? JSON.stringify(input.applied_fixes, null, 2)
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
