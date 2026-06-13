import type { ResolvedConfig } from "./config.js";
import type { ReviewStage } from "./types.js";
export declare class AllowedDocRootViolation extends Error {
    constructor(path: string, allowedRoots: readonly string[]);
}
export declare class TemplateLoadError extends Error {
    readonly path: string;
    constructor(path: string, cause: unknown);
}
export interface PromptVars {
    /** Generic key/value substitutions. */
    [key: string]: string | string[] | number | boolean | undefined | null;
}
export interface RenderInput {
    stage: ReviewStage;
    vars: PromptVars;
    /** Files to inject as code blocks. Each path is validated against allowed_doc_roots. */
    fileBlocks: Array<{
        label: string;
        path: string;
    }>;
    /** Drift preface produced by drift-detector (already validated). */
    driftPreface: string;
}
export declare class PromptRenderer {
    private readonly config;
    private readonly projectRoot;
    constructor(config: ResolvedConfig, projectRoot: string);
    templatePath(stage: ReviewStage): string;
    loadTemplate(stage: ReviewStage): string;
    render(input: RenderInput): string;
    /** Throws AllowedDocRootViolation if `relPath` resolves outside allowed_doc_roots. */
    assertWithinAllowedRoots(relPath: string): void;
}
//# sourceMappingURL=prompt-renderer.d.ts.map