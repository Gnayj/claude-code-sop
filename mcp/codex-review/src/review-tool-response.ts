import type { BreakerTriggered } from "./circuit-breakers.js";
import type { ParseFailure } from "./output-parser.js";
import type {
  BridgePreconditionFailure,
  FlowResult,
} from "./run-review-flow.js";
import type { ReviewEnvelope } from "./types.js";

export interface ReviewToolResponse {
  ok: boolean;
  envelope: ReviewEnvelope | null;
  breaker_tripped: BreakerTriggered | null;
  warnings: string[];
  awaiting_manual: NonNullable<FlowResult["awaitingManual"]> | null;
  bridge_precondition: BridgePreconditionFailure | null;
  parse_failure: ParseFailure | null;
}

/** Map an internal review-flow result to the stable MCP-visible snake_case payload. */
export function toReviewToolResponse(result: FlowResult): ReviewToolResponse {
  return {
    ok: result.ok,
    envelope: result.envelope ?? null,
    breaker_tripped: result.breakerTripped ?? null,
    warnings: result.warnings,
    awaiting_manual: result.awaitingManual ?? null,
    bridge_precondition: result.bridgePrecondition ?? null,
    parse_failure:
      result.parseResult && !result.parseResult.ok
        ? result.parseResult
        : null,
  };
}
