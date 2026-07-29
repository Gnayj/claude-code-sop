import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CANONICAL_CODEX_SKILL_ROOT,
  CODEX_SKILL_LIFECYCLE_FIXTURE_BINDINGS,
  CONTROL_SURFACE_CONTRACT_V1,
  LEGACY_CODEX_SKILL_ROOT,
  MIN_CODEX_SKILL_HOST_VERSION,
  classifyCodexSkillHostVersion,
  renderCodexSkillHostContract,
  renderFlowContract,
  renderSimplifyReadableCriteria,
  renderSimplifyContract,
  renderTierContract,
} from "../src/control-surface-contract.js";

const root = resolve(import.meta.dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

describe("Codex control-surface scaffold", () => {
  it("ships five canonical repo skills with valid discoverable frontmatter", () => {
    for (const name of ["project-sop", "handoff", "simplify", "sop-flow", "sop-tier"]) {
      const text = read(`templates/codex-scaffold/skills/${name}/SKILL.md`);
      expect(text).toMatch(/^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/);
      expect(text).toContain(`name: ${name}`);
    }
  });

  it("renders checked-in machine contracts without drift", () => {
    expect(read("templates/control-surface/flow-contract.md")).toBe(renderFlowContract("en"));
    expect(read("templates/control-surface/tier-contract.md")).toBe(renderTierContract("en"));
    expect(read("templates/control-surface/codex-skill-host-contract.md")).toBe(
      renderCodexSkillHostContract("en"),
    );
    expect(
      read("templates/codex-scaffold/skills/sop-flow/references/contract.md"),
    ).toBe(renderFlowContract("en"));
    expect(
      read("templates/codex-scaffold/skills/sop-tier/references/contract.md"),
    ).toBe(renderTierContract("en"));
    expect(read("templates/i18n/zh-CN/control-surface/flow-contract.md")).toBe(
      renderFlowContract("zh-CN"),
    );
    expect(read("templates/i18n/zh-CN/control-surface/tier-contract.md")).toBe(
      renderTierContract("zh-CN"),
    );
    expect(
      read("templates/codex-scaffold/skills/project-sop/references/host-contract.md"),
    ).toBe(renderCodexSkillHostContract("en"));
    expect(
      read(
        "templates/i18n/zh-CN/codex-scaffold/skills/project-sop/references/host-contract.md",
      ),
    ).toBe(renderCodexSkillHostContract("zh-CN"));
    expect(
      read("templates/i18n/zh-CN/control-surface/codex-skill-host-contract.md"),
    ).toBe(renderCodexSkillHostContract("zh-CN"));
    expect(
      JSON.parse(
        read("templates/codex-scaffold/skills/simplify/references/contract.json"),
      ),
    ).toEqual(renderSimplifyContract());
  });

  it("keeps the Phase 1 scaffold free of speculative Claude implement capability", () => {
    const paths = [
      "templates/codex-scaffold/skills/sop-flow/SKILL.md",
      "templates/codex-scaffold/skills/sop-flow/references/contract.md",
      "templates/codex-scaffold/skills/sop-tier/SKILL.md",
      "templates/codex-scaffold/skills/sop-tier/references/contract.md",
      "templates/control-surface/flow-contract.md",
      "templates/control-surface/tier-contract.md",
      "templates/control-surface/codex-skill-host-contract.md",
      "templates/codex-scaffold/skills/project-sop/references/host-contract.md",
      "templates/i18n/zh-CN/control-surface/codex-skill-host-contract.md",
      "templates/i18n/zh-CN/codex-scaffold/skills/project-sop/references/host-contract.md",
    ];
    const corpus = paths.map(read).join("\n");
    expect(corpus).not.toContain("[implement.claude]");
    expect(corpus).not.toContain("claude_implement");
    expect(corpus).not.toContain("claude-implement");
    expect(JSON.stringify(CONTROL_SURFACE_CONTRACT_V1)).not.toContain("claude-implement");
  });

  it("uses one canonical simplify JSON for both languages", () => {
    const zhSkill = read(
      "templates/i18n/zh-CN/codex-scaffold/skills/simplify/SKILL.md",
    );
    expect(zhSkill).toContain("references/contract.json");
    const manifest = read("templates/i18n/zh-CN/i18n-manifest.json");
    expect(manifest).not.toContain("simplify/references/contract.json");
    const simplifyJsonFiles = filesBelow(resolve(root, "templates")).filter(
      (path) => path.endsWith("simplify/references/contract.json"),
    );
    expect(simplifyJsonFiles).toHaveLength(1);
  });

  it("points AGENTS at the canonical .agents skill path", () => {
    for (const path of [
      "templates/codex-scaffold/AGENTS-snippet.md",
      "templates/i18n/zh-CN/codex-scaffold/AGENTS-snippet.md",
    ]) {
      expect(read(path)).toContain(".agents/skills/project-sop/SKILL.md");
      expect(read(path)).not.toContain(".codex/skills/project-sop/SKILL.md");
    }
  });

  it.each([
    ["codex-cli 0.145.0-alpha.1", "below-minimum"],
    ["codex-cli 0.145.0-alpha.2", "supported"],
    ["codex-cli 0.145.0", "supported"],
    ["codex-cli 0.146.0-alpha.1", "supported"],
    ["not-a-version", "unparseable"],
    ["", "missing"],
  ] as const)("applies the prerelease-aware host gate to %s", (output, status) => {
    expect(classifyCodexSkillHostVersion(output).status).toBe(status);
  });

  it("pins lifecycle and wrapper invariants in the shipped commands", () => {
    const init = read("commands/sop-init.md");
    const update = read("commands/sop-update.md");
    const lang = read("commands/sop-lang.md");
    const flow = read("commands/sop-flow.md");
    const tier = read("commands/sop-tier.md");
    for (const lifecycle of [init, update, lang]) {
      expect(lifecycle).toContain(
        "templates/control-surface/codex-skill-host-contract.md",
      );
    }
    expect(init).toContain(MIN_CODEX_SKILL_HOST_VERSION);
    expect(update).toContain(MIN_CODEX_SKILL_HOST_VERSION);
    expect(init).toContain("five discoverable entries");
    expect(init).toContain("legacy-skill-unknown-provenance");
    expect(update).toContain("--rollback-codex-skills");
    expect(update).toContain("stamp-schema-v1");
    expect(update).toContain("unfinished (scoped)");
    expect(lang).toContain("Never translate or mutate legacy `.codex/skills/**`");
    for (const wrapper of [flow, tier]) {
      expect(wrapper).toContain("ccsop_configure");
      expect(wrapper).toContain("/mcp");
      expect(wrapper).toMatch(/never edit|never edits/i);
      expect(wrapper).not.toContain("bridge loads config at startup only");
    }
  });

  it("renders host-gate facts into consumed artifacts without legacy pointers", () => {
    const host = read("templates/control-surface/codex-skill-host-contract.md");
    expect(host).toContain(MIN_CODEX_SKILL_HOST_VERSION);
    expect(host).toContain(CANONICAL_CODEX_SKILL_ROOT);
    expect(host).toContain(LEGACY_CODEX_SKILL_ROOT);
    for (const name of CONTROL_SURFACE_CONTRACT_V1.skills.names) {
      expect(host).toContain(`\`${name}\``);
    }

    const legacyPointer = `${LEGACY_CODEX_SKILL_ROOT}/project-sop/SKILL.md`;
    for (const scanRoot of [
      "templates/codex-scaffold",
      "templates/i18n/zh-CN/codex-scaffold",
    ]) {
      for (const path of filesBelow(resolve(root, scanRoot))) {
        const relative = path.slice(root.length + 1);
        if (relative.endsWith("project-sop/references/host-contract.md")) continue;
        expect(read(relative), relative).not.toContain(legacyPointer);
      }
    }
  });

  it("binds every lifecycle fixture id/outcome to the shipped command matrix", () => {
    const update = read("commands/sop-update.md");
    for (const [id, outcome] of Object.entries(
      CODEX_SKILL_LIFECYCLE_FIXTURE_BINDINGS,
    )) {
      expect(update).toContain(`| ${id} |`);
      expect(update).toContain(`\`${outcome}\``);
    }
  });

  it("keeps config template and public methodology on the Phase 1 contract", () => {
    const config = read("templates/config.toml.tpl");
    expect(config).toContain("control_surface_schema = 1");
    expect(config).toContain("scope_drift_lines_threshold = 400");
    expect(config).not.toContain("[implement.claude]");
    for (const path of [
      "templates/docs-scaffold/methodology/project-delivery-sop.md",
      "templates/i18n/zh-CN/docs-scaffold/methodology/project-delivery-sop.md",
    ]) {
      const text = read(path);
      expect(text).toContain("/simplify");
      expect(text).toContain("$simplify");
      expect(text).toContain(
        ".agents/skills/simplify/references/contract.json",
      );
    }
    expect(
      read("templates/docs-scaffold/methodology/project-delivery-sop.md"),
    ).toContain(renderSimplifyReadableCriteria("en"));
    expect(
      read("templates/docs-scaffold/methodology/workflow-overview.md"),
    ).toContain(renderSimplifyReadableCriteria("en"));
    expect(
      read(
        "templates/i18n/zh-CN/docs-scaffold/methodology/project-delivery-sop.md",
      ),
    ).toContain(renderSimplifyReadableCriteria("zh-CN"));
    expect(
      read(
        "templates/i18n/zh-CN/docs-scaffold/methodology/workflow-overview.md",
      ),
    ).toContain(renderSimplifyReadableCriteria("zh-CN"));
  });

  it("has complete, sha-valid maintained-language mappings", () => {
    const manifest = JSON.parse(
      read("templates/i18n/zh-CN/i18n-manifest.json"),
    ) as {
      files: Array<{
        source_path: string;
        source_sha: string;
        target_rel: string;
      }>;
    };
    for (const entry of manifest.files) {
      expect(existsSync(resolve(root, entry.source_path))).toBe(true);
      expect(existsSync(resolve(root, entry.target_rel))).toBe(true);
      expect(sha256(read(entry.source_path))).toBe(entry.source_sha);
    }
  });
});
