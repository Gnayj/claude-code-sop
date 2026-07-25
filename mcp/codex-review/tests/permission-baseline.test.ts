import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The shipped permission baseline (design bridge-deps-lifecycle §4.2). This guards the two
// properties code review pinned: EXACT enumeration of the three read-only review tools, and NO
// wildcard / NO codex_implement (a wildcard would silently grant the repo-writing dispatch tool).
// Path is cwd-relative (vitest runs from the package dir), matching model-effort.test.ts.
const TEMPLATE = "../../templates/permission-baseline.json";

const CANONICAL = [
  "mcp__plugin_ccsop_ccsop-review__codex_design_review",
  "mcp__plugin_ccsop_ccsop-review__codex_code_review",
  "mcp__plugin_ccsop_ccsop-review__codex_fix_review",
];

describe("permission-baseline template (design §4.2 fix-2)", () => {
  const raw = readFileSync(TEMPLATE, "utf8");
  const parsed = JSON.parse(raw) as { permissions?: { allow?: string[] } };
  const allow = parsed.permissions?.allow ?? [];

  it("enumerates exactly the three canonical review tools, in order", () => {
    expect(allow).toEqual(CANONICAL);
  });

  it("contains no wildcard entry (a `…__*` would also grant codex_implement)", () => {
    expect(allow.some((a) => a.includes("*"))).toBe(false);
  });

  it("never grants codex_implement (separate opt-in, not in the baseline)", () => {
    expect(allow.some((a) => a.includes("codex_implement"))).toBe(false);
  });

  it("uses the canonical plugin-prefixed tool names, not the 0.1.0-era bare names", () => {
    expect(allow.every((a) => a.startsWith("mcp__plugin_ccsop_ccsop-review__"))).toBe(true);
    expect(allow.some((a) => a.startsWith("mcp__ccsop-review__"))).toBe(false);
  });

  it("is a valid settings.json shape (permissions.allow array)", () => {
    expect(Array.isArray(parsed.permissions?.allow)).toBe(true);
  });
});
