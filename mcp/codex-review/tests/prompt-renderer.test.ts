import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PromptRenderer, AllowedDocRootViolation } from "../src/prompt-renderer.js";
import { defaultConfig, makeTempDir, rmDir } from "./test-helpers.js";

function setupTplAndDoc(): {
  root: string;
  config: ReturnType<typeof defaultConfig>;
  cleanup: () => void;
} {
  const root = makeTempDir("codex-review-renderer-");
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, ".codex-review/templates/design-review.md.tpl"),
    [
      "# design",
      "max sections = {{design_mechanical_max_sections}}",
      "max fix lines = {{code_mechanical_max_fix_lines}}",
      "max modules = {{code_mechanical_max_modules}}",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(root, ".codex-review/templates/code-review.md.tpl"),
    "code tpl {{code_mechanical_max_fix_lines}}",
    "utf8",
  );
  writeFileSync(
    join(root, ".codex-review/templates/fix-review.md.tpl"),
    "fix tpl {{code_mechanical_max_modules}}",
    "utf8",
  );
  writeFileSync(join(root, "docs/d.md"), "design content", "utf8");
  const config = defaultConfig({
    meta: {
      project_id: "renderer-test",
      project_name: "renderer-test",
      language: "zh-CN",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  return { root, config, cleanup: () => rmDir(root) };
}

describe("prompt-renderer threshold injection (IM-2)", () => {
  it("renders the 3 Round 3 thresholds (8 / 100 / 1) in the design template", () => {
    const { root, config, cleanup } = setupTplAndDoc();
    try {
      const renderer = new PromptRenderer(config, root);
      const out = renderer.render({
        stage: "design",
        vars: {
          design_mechanical_max_sections: config.circuit_breakers.design_mechanical_max_sections,
          code_mechanical_max_fix_lines: config.circuit_breakers.code_mechanical_max_fix_lines,
          code_mechanical_max_modules: config.circuit_breakers.code_mechanical_max_modules,
        },
        fileBlocks: [],
        driftPreface: "",
      });
      expect(out).toContain("max sections = 8");
      expect(out).toContain("max fix lines = 100");
      expect(out).toContain("max modules = 1");
    } finally {
      cleanup();
    }
  });

  it("renders thresholds in code + fix templates too", () => {
    const { root, config, cleanup } = setupTplAndDoc();
    try {
      const renderer = new PromptRenderer(config, root);
      const codeOut = renderer.render({
        stage: "code",
        vars: {
          code_mechanical_max_fix_lines: config.circuit_breakers.code_mechanical_max_fix_lines,
        },
        fileBlocks: [],
        driftPreface: "",
      });
      expect(codeOut).toContain("code tpl 100");
      const fixOut = renderer.render({
        stage: "fix",
        vars: {
          code_mechanical_max_modules: config.circuit_breakers.code_mechanical_max_modules,
        },
        fileBlocks: [],
        driftPreface: "",
      });
      expect(fixOut).toContain("fix tpl 1");
    } finally {
      cleanup();
    }
  });

  it("rejects file block paths outside allowed_doc_roots with AllowedDocRootViolation", () => {
    const { root, config, cleanup } = setupTplAndDoc();
    try {
      const renderer = new PromptRenderer(config, root);
      expect(() =>
        renderer.render({
          stage: "design",
          vars: {},
          fileBlocks: [{ label: "Bad", path: "/etc/passwd" }],
          driftPreface: "",
        }),
      ).toThrow(AllowedDocRootViolation);
      // Relative-but-still-outside (../ traversal) too.
      expect(() =>
        renderer.render({
          stage: "design",
          vars: {},
          fileBlocks: [{ label: "BadRel", path: "../../etc/passwd" }],
          driftPreface: "",
        }),
      ).toThrow(AllowedDocRootViolation);
    } finally {
      cleanup();
    }
  });
});
