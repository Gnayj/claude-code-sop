// Allowlist grammar + card ```files block + safety-tier tests
// (design ccsop-codex-implement §4.2.A / §4.3 / §8 "policy" + "allowlist grammar" groups).

import { describe, expect, it } from "vitest";

import {
  canonicalSetsEqual,
  isControlPlanePath,
  parseAllowlist,
  parseFilesBlockFromCard,
} from "../src/allowlist.js";
import {
  IMPLEMENT_MIN_POLICY,
  MIN_SAFETY_POLICY,
  enforceMinSafetyPolicy,
} from "../src/safety.js";
import { ConfigSchema } from "../src/config.js";
import { defaultConfig } from "./test-helpers.js";

// ---------- policy tiering ----------

describe("per-tool-class safety tiering (§4.3)", () => {
  it("review-class MIN_SAFETY_POLICY is byte-identical to the pre-implement contract", () => {
    // Byte-pin (design §6.1): the implement feature must not alter the review tier.
    expect(MIN_SAFETY_POLICY.sandboxMode).toBe("read-only");
    expect(MIN_SAFETY_POLICY.approvalPolicy).toBe("never");
    expect(MIN_SAFETY_POLICY.network).toBe(false);
    expect(MIN_SAFETY_POLICY.webSearch).toBe(false);
    expect(MIN_SAFETY_POLICY.outputParserDangerVerbsRegex.source).toBe(
      "\\b(git\\s+(commit|push|reset|checkout)|rm|mv|chmod|curl|wget)\\b",
    );
    expect(MIN_SAFETY_POLICY.defaultDesignMechanicalMaxSections).toBe(8);
    expect(MIN_SAFETY_POLICY.defaultCodeMechanicalMaxFixLines).toBe(100);
    expect(MIN_SAFETY_POLICY.defaultCodeMechanicalMaxModules).toBe(1);
  });

  it("implement tier is workspace-write/never/no-network/no-search with shrink-only defaults", () => {
    expect(IMPLEMENT_MIN_POLICY.sandboxMode).toBe("workspace-write");
    expect(IMPLEMENT_MIN_POLICY.approvalPolicy).toBe("never");
    expect(IMPLEMENT_MIN_POLICY.network).toBe(false);
    expect(IMPLEMENT_MIN_POLICY.webSearch).toBe(false);
    expect(IMPLEMENT_MIN_POLICY.defaultMaxImplementRounds).toBe(3);
    expect(IMPLEMENT_MIN_POLICY.defaultMaxFileBytes).toBe(2097152);
  });

  it("config parses with implement disabled by default", () => {
    const config = defaultConfig();
    expect(config.implement.enabled).toBe(false);
    expect(config.implement.max_implement_rounds).toBe(3);
    expect(config.implement.max_file_bytes).toBe(2097152);
  });

  it("shrink-only: widening implement thresholds rejects at startup", () => {
    const config = defaultConfig();
    config.implement = { enabled: true, max_implement_rounds: 4, max_file_bytes: 2097152 };
    expect(() => enforceMinSafetyPolicy(config, {})).toThrow(/max_implement_rounds=4/);
    config.implement = { enabled: true, max_implement_rounds: 3, max_file_bytes: 3_000_000 };
    expect(() => enforceMinSafetyPolicy(config, {})).toThrow(/max_file_bytes=3000000/);
    // Tightening is fine.
    config.implement = { enabled: true, max_implement_rounds: 1, max_file_bytes: 1024 };
    expect(() => enforceMinSafetyPolicy(config, {})).not.toThrow();
  });

  it("raw [implement] widening attempts (danger-full-access / approvals / network) reject", () => {
    const config = defaultConfig();
    for (const raw of [
      { implement: { sandbox_mode: "danger-full-access" } },
      { implement: { approval_policy: "on-request" } },
      { implement: { network: true } },
      { implement: { web_search_enabled: true } },
    ]) {
      expect(() => enforceMinSafetyPolicy(config, raw)).toThrow(/does not match server-required/);
    }
    // Restating the required tier verbatim is not a violation.
    expect(() =>
      enforceMinSafetyPolicy(config, { implement: { sandbox_mode: "workspace-write" } }),
    ).not.toThrow();
  });

  it("[implement] schema: invalid values fail loud; unknown config table key untouched review class", () => {
    const minimal = {
      meta: { project_id: "p", project_name: "p", repo_root: ".", allowed_doc_roots: ["docs/"] },
      paths: {
        sop: "a", collaboration_sop: "b", handoff: "c", plans_active: "d",
        plans_completed: "e", sessions_dir: "f", backlog_dir: "g", archive_dir: "h",
      },
      review: {
        design: { prompt_template: "t", verdict_enum: ["Go", "No-Go"] },
        code: { prompt_template: "t", verdict_enum: ["Pass", "No-Go"] },
        fix: { prompt_template: "t", verdict_enum: ["All-fixed", "No-Go"] },
      },
    };
    expect(ConfigSchema.parse(minimal).implement.enabled).toBe(false);
    expect(() =>
      ConfigSchema.parse({ ...minimal, implement: { enabled: "yes" } }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({ ...minimal, implement: { max_file_bytes: -1 } }),
    ).toThrow();
  });
});

// ---------- allowlist grammar ----------

describe("allowlist machine grammar (§4.2.A)", () => {
  it("accepts exact regular-file POSIX paths and canonicalizes (dedup + byte-sort)", () => {
    const r = parseAllowlist(["src/b.ts", "src/a.ts", "src/b.ts", "docs/x y/üni.md"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toEqual(["docs/x y/üni.md", "src/a.ts", "src/b.ts"]);
  });

  it.each([
    ["/etc/passwd", /absolute/],
    ["C:stuff", /drive-letter/],
    ["a/../b.ts", /traversal/],
    ["./a.ts", /traversal/],
    ["src/*.ts", /glob/],
    ["src/?x.ts", /glob/],
    ["src/[ab].ts", /glob/],
    ["src/dir/", /directory/],
    ["src//x.ts", /empty segment/],
    ["src\\x.ts", /backslash/],
    ["bad.ts", /control character/],
    ["", /empty path/],
  ])("rejects %j", (path, re) => {
    const r = parseAllowlist([path as string]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(re as RegExp);
  });

  it("control-plane denylist: every root dot-path + AGENTS.md + sync script", () => {
    for (const p of [
      ".gitignore", ".gitattributes", ".gitmodules", ".mcp.json",
      ".ccsop/manifest.json", ".codex-review/config.toml", ".claude/settings.json",
      ".claude-plugin/plugin.json", ".codex/skills/x.md", ".idea/ws.xml",
      ".anything-else", "AGENTS.md", "scripts/sync-public.sh",
    ]) {
      expect(isControlPlanePath(p)).toBe(true);
      const r = parseAllowlist([p]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join("\n")).toMatch(/control-plane/);
    }
    // Nested dotfiles are NOT control-plane (only root-anchored dot segments are).
    expect(isControlPlanePath("src/.env.example")).toBe(false);
    expect(parseAllowlist(["src/.env.example"]).ok).toBe(true);
    expect(isControlPlanePath("scripts/other.sh")).toBe(false);
  });

  it("empty allowlist rejects", () => {
    const r = parseAllowlist([]);
    expect(r.ok).toBe(false);
  });
});

// ---------- card ```files block ----------

describe("implement-card ```files block (§4.1 card agreement)", () => {
  const card = (files: string) =>
    `stage: implement\ngoal: x\n\n\`\`\`files\n${files}\n\`\`\`\n\nacceptance:\n- t\n`;

  it("parses the single mandatory block", () => {
    const r = parseFilesBlockFromCard(card("src/a.ts\nsrc/b.ts\n\n"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("missing block / multiple blocks / unclosed block are errors", () => {
    expect(parseFilesBlockFromCard("no block here").ok).toBe(false);
    const two = card("a.ts") + "\n```files\nb.ts\n```\n";
    const r2 = parseFilesBlockFromCard(two);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.join()).toMatch(/2 .*blocks|blocks; exactly one/);
    const unclosed = "```files\na.ts\n";
    const r3 = parseFilesBlockFromCard(unclosed);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.join()).toMatch(/unclosed/);
  });

  it("a ```files line inside another fenced block is content, not a marker", () => {
    const text =
      "```text\nexample:\n```files\nnot/real.ts\n```\n\n" + card("real/one.ts");
    const r = parseFilesBlockFromCard(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toEqual(["real/one.ts"]);
  });

  it("card↔input equality is canonical byte equality", () => {
    const a = parseAllowlist(["b.ts", "a.ts"]);
    const b = parseFilesBlockFromCard(card("a.ts\nb.ts"));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(canonicalSetsEqual(a.canonical, b.canonical)).toBe(true);
      expect(canonicalSetsEqual(a.canonical, ["a.ts"])).toBe(false);
    }
  });
});
