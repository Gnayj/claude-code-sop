// Prompt template loader + renderer.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §10 + §3.0.1
//
// Templates use `{{var}}` placeholders. The renderer enforces allowed_doc_roots
// boundary: any input file path that resolves outside config.meta.allowed_doc_roots
// causes a hard error (not a quiet skip).

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import type { ResolvedConfig } from "./config.js";
import type { ReviewStage } from "./types.js";

export class AllowedDocRootViolation extends Error {
  constructor(path: string, allowedRoots: readonly string[]) {
    super(
      `path "${path}" is outside allowed_doc_roots [${allowedRoots.join(", ")}]; ` +
        `prompt-renderer refuses to inject it.`,
    );
    this.name = "AllowedDocRootViolation";
  }
}

export class TemplateLoadError extends Error {
  constructor(public readonly path: string, cause: unknown) {
    super(`failed to load template ${path}: ${(cause as Error).message}`);
    this.name = "TemplateLoadError";
  }
}

export interface PromptVars {
  /** Generic key/value substitutions. */
  [key: string]: string | string[] | number | boolean | undefined | null;
}

export interface RenderInput {
  stage: ReviewStage;
  vars: PromptVars;
  /** Files to inject as code blocks. Each path is validated against allowed_doc_roots. */
  fileBlocks: Array<{ label: string; path: string }>;
  /** Drift preface produced by drift-detector (already validated). */
  driftPreface: string;
}

export class PromptRenderer {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly projectRoot: string,
  ) {}

  templatePath(stage: ReviewStage): string {
    const t =
      stage === "design"
        ? this.config.review.design.prompt_template
        : stage === "code"
          ? this.config.review.code.prompt_template
          : this.config.review.fix.prompt_template;
    return resolvePath(this.projectRoot, t);
  }

  loadTemplate(stage: ReviewStage): string {
    const path = this.templatePath(stage);
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      throw new TemplateLoadError(path, err);
    }
  }

  render(input: RenderInput): string {
    const tpl = this.loadTemplate(input.stage);
    const sections: string[] = [];

    // Drift preface FIRST so Codex sees doc updates before the main prompt body.
    if (input.driftPreface.trim().length > 0) {
      sections.push(input.driftPreface.trim());
    }

    // Substitute simple {{var}} placeholders in the loaded template.
    const body = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      const v = input.vars[key];
      if (v === undefined || v === null) return "";
      if (Array.isArray(v)) return v.map(String).join("\n");
      return String(v);
    });
    sections.push(body);

    // File-block appendix.
    if (input.fileBlocks.length > 0) {
      sections.push("\n---\n## 注入的文件\n");
      for (const fb of input.fileBlocks) {
        this.assertWithinAllowedRoots(fb.path);
        const abs = resolvePath(this.projectRoot, fb.path);
        if (!existsSync(abs)) {
          sections.push(`### ${fb.label} (${fb.path}) [missing on disk]\n`);
          continue;
        }
        const content = readFileSync(abs, "utf8");
        sections.push(`### ${fb.label} (${fb.path})\n\`\`\`\n${content}\n\`\`\`\n`);
      }
    }

    return sections.join("\n\n");
  }

  /** Throws AllowedDocRootViolation if `relPath` resolves outside allowed_doc_roots. */
  assertWithinAllowedRoots(relPath: string): void {
    if (isAbsolute(relPath)) {
      throw new AllowedDocRootViolation(relPath, this.config.meta.allowed_doc_roots);
    }
    const allowed = this.config.meta.allowed_doc_roots.map((r) =>
      resolvePath(this.projectRoot, r),
    );
    const target = resolvePath(this.projectRoot, relPath);
    const within = allowed.some((root) => {
      const rel = relative(root, target);
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!within) {
      throw new AllowedDocRootViolation(relPath, this.config.meta.allowed_doc_roots);
    }
  }
}
