import { z } from "zod";

import type {
  ImplementFlowDependencies,
  ImplementFlowResult,
} from "../run-implement-flow.js";
import { runImplementFlow } from "../run-implement-flow.js";

export const claudeImplementToolName = "claude_implement";

export const claudeImplementToolSchema = {
  name: claudeImplementToolName,
  description:
    "Dispatch one bounded implementation proposal to the authenticated Claude CLI in a " +
    "Linux bubblewrap scratch. Requires schema=2, exact codex+claude ownership, operator " +
    "enabled=true, an active task-card SHA, and an exact <=256 path allowlist. The tool never " +
    "writes or applies changes to the caller repository.",
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      design_id: { type: "string" },
      task_card_path: { type: "string" },
      task_card_sha256: {
        type: "string",
        pattern: "^[a-f0-9]{64}$",
      },
      files_allowlist: {
        type: "array",
        maxItems: 256,
        items: { type: "string" },
      },
      work_order: { type: "string" },
      dispatch_key: { type: "string" },
      previous_findings: {},
    },
    required: [
      "design_id",
      "task_card_path",
      "task_card_sha256",
      "files_allowlist",
      "work_order",
      "dispatch_key",
    ],
  },
} as const;

const ClaudeImplementInput = z
  .object({
    design_id: z.string().min(1),
    task_card_path: z.string().min(1),
    task_card_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    files_allowlist: z.array(z.string()).max(256),
    work_order: z.string().min(1),
    dispatch_key: z.string(),
    previous_findings: z.unknown().optional(),
  })
  .strict();

export async function handleClaudeImplement(
  deps: ImplementFlowDependencies,
  rawInput: unknown,
  signal?: AbortSignal,
): Promise<ImplementFlowResult> {
  if (deps.writerKind !== "claude") {
    throw new Error("claude_implement was wired to a non-Claude writer adapter");
  }
  const input = ClaudeImplementInput.parse(rawInput);
  return runImplementFlow(deps, {
    designId: input.design_id,
    taskCardPath: input.task_card_path,
    taskCardSha256: input.task_card_sha256,
    filesAllowlist: input.files_allowlist,
    workOrder: input.work_order,
    dispatchKey: input.dispatch_key,
    previousFindings: input.previous_findings,
    ...(signal ? { signal } : {}),
  });
}
