export interface DiffBudget {
    /** Fallback when aLines + bLines exceeds this (default 100_000). */
    maxTotalLines?: number;
    /** Fallback when the Myers edit distance exploration exceeds this D (default 1_000). */
    maxD?: number;
    /** Cancellation hook — called periodically inside the search; throw to abort. */
    checkCancel?: () => void;
}
export declare function needsGitPathQuoting(path: string): boolean;
/** C-style quote `prefix/path` (prefix = "a" | "b"); bare when no quoting is required. */
export declare function quoteGitPath(prefix: string, path: string): string;
export declare function gitBlobSha1(bytes: Buffer): string;
export interface DiffSide {
    present: boolean;
    mode?: "100644" | "100755";
    bytes?: Buffer;
}
export interface FileDiffResult {
    text: Buffer;
    added: number;
    removed: number;
    usedFallback: boolean;
}
/**
 * Build the git-format patch section for ONE path. `before`/`after` are the sealed sides
 * (absent ⇔ present:false). Content-and-mode-identical sides are the caller's bug (no delta).
 */
export declare function generateFilePatch(path: string, before: DiffSide, after: DiffSide, budget?: DiffBudget): FileDiffResult;
export interface PatchEntry {
    path: string;
    before: DiffSide;
    after: DiffSide;
}
export interface BuiltPatch {
    patch: Buffer;
    perFile: Map<string, {
        added: number;
        removed: number;
        usedFallback: boolean;
    }>;
}
/** Concatenate per-file sections in the given (already-sorted) entry order. */
export declare function buildGitPatch(entries: readonly PatchEntry[], budget?: DiffBudget): BuiltPatch;
//# sourceMappingURL=diff.d.ts.map