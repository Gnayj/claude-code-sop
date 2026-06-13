// Prompt template loader + renderer.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §10 + §3.0.1
//
// Templates use `{{var}}` placeholders. The renderer enforces allowed_doc_roots
// boundary: any input file path that resolves outside config.meta.allowed_doc_roots
// causes a hard error (not a quiet skip).
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
export class AllowedDocRootViolation extends Error {
    constructor(path, allowedRoots) {
        super(`path "${path}" is outside allowed_doc_roots [${allowedRoots.join(", ")}]; ` +
            `prompt-renderer refuses to inject it.`);
        this.name = "AllowedDocRootViolation";
    }
}
export class TemplateLoadError extends Error {
    path;
    constructor(path, cause) {
        super(`failed to load template ${path}: ${cause.message}`);
        this.path = path;
        this.name = "TemplateLoadError";
    }
}
export class PromptRenderer {
    config;
    projectRoot;
    constructor(config, projectRoot) {
        this.config = config;
        this.projectRoot = projectRoot;
    }
    templatePath(stage) {
        const t = stage === "design"
            ? this.config.review.design.prompt_template
            : stage === "code"
                ? this.config.review.code.prompt_template
                : this.config.review.fix.prompt_template;
        return resolvePath(this.projectRoot, t);
    }
    loadTemplate(stage) {
        const path = this.templatePath(stage);
        try {
            return readFileSync(path, "utf8");
        }
        catch (err) {
            throw new TemplateLoadError(path, err);
        }
    }
    render(input) {
        const tpl = this.loadTemplate(input.stage);
        const sections = [];
        // Drift preface FIRST so Codex sees doc updates before the main prompt body.
        if (input.driftPreface.trim().length > 0) {
            sections.push(input.driftPreface.trim());
        }
        // Substitute simple {{var}} placeholders in the loaded template.
        const body = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
            const v = input.vars[key];
            if (v === undefined || v === null)
                return "";
            if (Array.isArray(v))
                return v.map(String).join("\n");
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
    assertWithinAllowedRoots(relPath) {
        if (isAbsolute(relPath)) {
            throw new AllowedDocRootViolation(relPath, this.config.meta.allowed_doc_roots);
        }
        const allowed = this.config.meta.allowed_doc_roots.map((r) => resolvePath(this.projectRoot, r));
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
//# sourceMappingURL=prompt-renderer.js.map