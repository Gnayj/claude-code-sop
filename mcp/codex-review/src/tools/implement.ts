// MCP tool handler: codex_implement (proposal mode — design ccsop-codex-implement §4.1).
//
// The tool dispatches ONE bounded work order to a codex writer in an isolated scratch
// workspace and returns a server-derived validated patch artifact. It never writes the
// caller repository and never applies the patch — the driver reviews and applies it.

import { z } from "zod";

import type { ImplementFlowDependencies, ImplementFlowResult } from "../run-implement-flow.js";
import { runImplementFlow } from "../run-implement-flow.js";

export const implementToolName = "codex_implement";

export const implementToolSchema = {
  name: implementToolName,
  description:
    "Dispatch one bounded implement work order to a codex writer (claude+codex preside flow, " +
    "collaboration.md §1.D). Returns a validated patch artifact under .codex-review/dispatches/ " +
    "— review it per §9, then apply with `git apply --check` + `git apply`. Requires " +
    "[implement] enabled=true and a task card with a ```files allowlist block.",
  inputSchema: {
    type: "object" as const,
    properties: {
      design_id: { type: "string" },
      task_card_path: { type: "string" },
      files_allowlist: { type: "array", items: { type: "string" } },
      work_order: { type: "string" },
      dispatch_key: { type: "string" },
      previous_findings: {},
    },
    required: ["design_id", "task_card_path", "files_allowlist", "work_order", "dispatch_key"],
  },
};

const ImplementInput = z.object({
  design_id: z.string().min(1),
  task_card_path: z.string().min(1),
  files_allowlist: z.array(z.string()),
  work_order: z.string().min(1),
  dispatch_key: z.string(),
  previous_findings: z.unknown().optional(),
});

export async function handleImplement(
  deps: ImplementFlowDependencies,
  rawInput: unknown,
  signal?: AbortSignal,
): Promise<ImplementFlowResult> {
  const input = ImplementInput.parse(rawInput);
  return runImplementFlow(deps, {
    designId: input.design_id,
    taskCardPath: input.task_card_path,
    filesAllowlist: input.files_allowlist,
    workOrder: input.work_order,
    dispatchKey: input.dispatch_key,
    previousFindings: input.previous_findings,
    ...(signal ? { signal } : {}),
  });
}
