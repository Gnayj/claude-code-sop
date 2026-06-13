// MCP tool handler: codex_fix_review
// Spec: docs/methodology/codex-review-bridge-design.md §3.3

import { FixReviewInput, type FixReviewInput as FixReviewInputT } from "../types.js";
import type { FlowDependencies, FlowResult } from "../run-review-flow.js";
import { runReviewFlow } from "../run-review-flow.js";

export const fixReviewToolName = "codex_fix_review";

export const fixReviewToolSchema = {
  name: fixReviewToolName,
  description:
    "Run a Codex fix-review against previous-round Critical/Important conclusions. " +
    "Verdict ∈ {All-fixed, Partial, New-issues, Rereview-after-fixes, No-Go}.",
  inputSchema: {
    type: "object" as const,
    properties: {
      design_id: { type: "string" },
      task_card_path: { type: "string" },
      design_doc_paths: { type: "array", items: { type: "string" } },
      module_doc_paths: { type: "array", items: { type: "string" } },
      handoff_path: { type: "string" },
      fix_diff_spec: { type: "string" },
      changed_files: { type: "array", items: { type: "string" } },
      fix_diff_lines: { type: "number" },
      docs_updated: { type: "array", items: { type: "string" } },
      claude_output: { type: "object" },
      claude_fix_notes: { type: "array" },
      previous_round_id: { type: "string" },
      previous_round_conclusions: { type: "array" },
      applied_fixes: { type: "array" },
      tests_run: { type: "array", items: { type: "string" } },
      validation_evidence: { type: "string" },
      force_new_thread: { type: "boolean" },
      manual_verdict_path: { type: "string" },
    },
    required: [
      "design_id",
      "task_card_path",
      "design_doc_paths",
      "handoff_path",
      "fix_diff_spec",
      "changed_files",
      "fix_diff_lines",
      "docs_updated",
      "claude_output",
      "claude_fix_notes",
      "previous_round_id",
      "previous_round_conclusions",
      "tests_run",
      "validation_evidence",
    ],
  },
};

export async function handleFixReview(
  deps: FlowDependencies,
  rawInput: unknown,
): Promise<FlowResult> {
  const input: FixReviewInputT = FixReviewInput.parse(rawInput);
  const fileBlocks = [
    { label: "Task card", path: input.task_card_path },
    { label: "Handoff", path: input.handoff_path },
    ...(input.module_doc_paths ?? []).map((p) => ({ label: "Module doc", path: p })),
  ];
  const cb = deps.config.circuit_breakers;
  return runReviewFlow(deps, {
    stage: "fix",
    designId: input.design_id,
    designDocPaths: input.design_doc_paths,
    fileBlocks,
    promptVars: {
      design_id: input.design_id,
      task_card_path: input.task_card_path,
      handoff_path: input.handoff_path,
      fix_diff_spec: input.fix_diff_spec,
      changed_files: input.changed_files,
      fix_diff_lines: input.fix_diff_lines,
      docs_updated: input.docs_updated,
      claude_output_json: JSON.stringify(input.claude_output, null, 2),
      claude_fix_notes_json: JSON.stringify(input.claude_fix_notes, null, 2),
      previous_round_id: input.previous_round_id,
      previous_round_conclusions_json: JSON.stringify(
        input.previous_round_conclusions,
        null,
        2,
      ),
      applied_fixes_json: input.applied_fixes
        ? JSON.stringify(input.applied_fixes, null, 2)
        : "",
      tests_run: input.tests_run,
      validation_evidence: input.validation_evidence,
      design_mechanical_max_sections: cb.design_mechanical_max_sections,
      code_mechanical_max_fix_lines: cb.code_mechanical_max_fix_lines,
      code_mechanical_max_modules: cb.code_mechanical_max_modules,
    },
    // fix stage REQUIRES previous_round_conclusions (zod schema enforces .min(1)).
    // The "previous_round_resolved" check inside the parser uses this signal.
    hasPreviousRoundResolved: input.previous_round_conclusions.length > 0,
    forceNewThread: input.force_new_thread === true,
    fixDiffLines: input.fix_diff_lines,
    manualVerdictPath: input.manual_verdict_path,
  });
}
