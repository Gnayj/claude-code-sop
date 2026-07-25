import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { defaultConfig } from "./test-helpers.js";

describe("codex model/effort config", () => {
  it("accepts the SDK effort enum, defaults empty, and rejects typos", () => {
    for (const effort of ["", "minimal", "low", "medium", "high", "xhigh"]) {
      const raw = defaultConfig() as any;
      raw.review.codex.effort = effort;
      raw.implement.effort = effort;
      raw.codex.default_effort = effort;
      expect(ConfigSchema.safeParse(raw).success).toBe(true);
    }
    const defaults = defaultConfig() as any;
    delete defaults.review.codex.effort;
    delete defaults.implement.model;
    delete defaults.implement.effort;
    delete defaults.codex.default_effort;
    const parsed = ConfigSchema.parse(defaults);
    expect([parsed.review.codex.effort, parsed.implement.model, parsed.implement.effort,
      parsed.codex.default_effort]).toEqual(["", "", "", ""]);
    defaults.review.codex.effort = "hgih";
    expect(ConfigSchema.safeParse(defaults).success).toBe(false);
  });

  it("ships matching codex and implement template keys", () => {
    const tpl = readFileSync("../../templates/config.toml.tpl", "utf8");
    expect(tpl).toMatch(/\[codex\]\ndefault_model = ""\ndefault_effort = ""/);
    expect(tpl).toMatch(/\[implement\][\s\S]*\nmodel = ""[\s\S]*\neffort = ""/);
    expect(tpl).toContain("no longer inherits review.codex.model");
  });

  it("defaults [codex].path to empty and accepts an explicit binary path", () => {
    const parsed = ConfigSchema.parse(defaultConfig() as any);
    expect(parsed.codex.path).toBe(""); // "" => fall through to the package → PATH → error chain

    const withPath = defaultConfig() as any;
    withPath.codex.path = "/usr/local/bin/codex";
    const p2 = ConfigSchema.safeParse(withPath);
    expect(p2.success).toBe(true);
    if (p2.success) expect(p2.data.codex.path).toBe("/usr/local/bin/codex");
  });

  it("documents the codex-binary resolution chain in the template", () => {
    const tpl = readFileSync("../../templates/config.toml.tpl", "utf8");
    expect(tpl).toMatch(/\[codex\][\s\S]*\npath = ""/); // key present under [codex]
    // The 4-link order must be documented so operators understand precedence, not just the key.
    expect(tpl).toContain("path  (this key)");
    expect(tpl).toContain("@openai/codex package");
    expect(tpl).toContain("codex on PATH");
  });
});
