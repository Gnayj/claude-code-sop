import { describe, expect, it } from "vitest";

import type { FlowResult } from "../src/run-review-flow.js";
import { toReviewToolResponse } from "../src/review-tool-response.js";
import { makeEnvelope } from "./test-helpers.js";

describe("review tool MCP response", () => {
  it("surfaces a bridge precondition without fabricating a parse failure", () => {
    const result: FlowResult = {
      ok: false,
      bridgePrecondition: {
        reason: "diff_spec_required",
        detail: "diff_spec is required",
      },
      warnings: ["diff_spec is required"],
    };

    expect(toReviewToolResponse(result)).toEqual({
      ok: false,
      envelope: null,
      breaker_tripped: null,
      warnings: ["diff_spec is required"],
      awaiting_manual: null,
      bridge_precondition: {
        reason: "diff_spec_required",
        detail: "diff_spec is required",
      },
      parse_failure: null,
    });
  });

  it("keeps a real parser failure separate from bridge preconditions", () => {
    const parseFailure = {
      ok: false as const,
      reason: "schema_violation" as const,
      detail: "verdict missing",
      raw_excerpt: "{}",
    };
    const result: FlowResult = {
      ok: false,
      parseResult: parseFailure,
      warnings: ["parser rejected output"],
    };

    const response = toReviewToolResponse(result);
    expect(response.bridge_precondition).toBeNull();
    expect(response.parse_failure).toEqual(parseFailure);
  });

  it("preserves provider-failure breaker and parser payloads", () => {
    const result: FlowResult = {
      ok: false,
      parseResult: {
        ok: false,
        reason: "non_json",
        detail: "provider turn failed",
        raw_excerpt: "",
      },
      breakerTripped: {
        name: "codex_unavailable",
        message: "provider failure streak reached threshold",
      },
      warnings: ["provider turn failed"],
    };

    const response = toReviewToolResponse(result);
    expect(response.bridge_precondition).toBeNull();
    expect(response.breaker_tripped?.name).toBe("codex_unavailable");
    expect(response.parse_failure?.reason).toBe("non_json");
  });

  it("preserves awaiting-manual control output with no failure channel", () => {
    const result: FlowResult = {
      ok: true,
      awaitingManual: {
        prompt_path: "/tmp/prompt.md",
        verdict_path_expected: "/tmp/verdict.json",
      },
      warnings: ["awaiting manual verdict"],
    };

    const response = toReviewToolResponse(result);
    expect(response.awaiting_manual).toEqual(result.awaitingManual);
    expect(response.bridge_precondition).toBeNull();
    expect(response.parse_failure).toBeNull();
  });

  it("surfaces scope-drift precondition together with its breaker", () => {
    const result: FlowResult = {
      ok: false,
      bridgePrecondition: {
        reason: "scope_drift",
        detail: "scope drift threshold exceeded",
      },
      breakerTripped: {
        name: "scope_drift",
        message: "scope drift threshold exceeded",
      },
      warnings: ["scope drift threshold exceeded"],
    };

    const response = toReviewToolResponse(result);
    expect(response.bridge_precondition?.reason).toBe("scope_drift");
    expect(response.breaker_tripped?.name).toBe("scope_drift");
    expect(response.parse_failure).toBeNull();
  });

  it("keeps both failure channels null on success", () => {
    const envelope = makeEnvelope("code", "Pass");
    const result: FlowResult = {
      ok: true,
      envelope,
      parseResult: {
        ok: true,
        envelope,
        warnings: [],
        forced_upgrade: false,
        downgraded_for_missing_factors: false,
      },
      warnings: [],
    };

    const response = toReviewToolResponse(result);
    expect(response.envelope).toBe(envelope);
    expect(response.bridge_precondition).toBeNull();
    expect(response.parse_failure).toBeNull();
  });
});
