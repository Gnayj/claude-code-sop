import type { DesignDocFileState, ThreadState } from "./types.js";
export type DriftCategory = "unchanged" | "modified" | "added" | "removed";
export interface FileDriftEntry {
    path: string;
    category: DriftCategory;
    oldSha: string | null;
    newSha: string | null;
    /** File contents if added/modified; otherwise null. */
    content: string | null;
}
export interface DriftPlan {
    entries: FileDriftEntry[];
    /** New per-file state map to persist after a successful round. */
    nextDesignDocFiles: Record<string, DesignDocFileState>;
}
export declare function computeFileSha(content: string): string;
/**
 * Compare current `inputPaths` (with their on-disk content) against `state.design_doc_files`.
 * Removed = path was tracked in state but missing from inputPaths (or file no longer exists on disk).
 */
export declare function planDrift(state: ThreadState | null, inputPaths: readonly string[], resolvePath: (p: string) => string): DriftPlan;
/** Generate the prompt-prefix announcing drift. Empty string if all unchanged. */
export declare function renderDriftPreface(plan: DriftPlan): string;
//# sourceMappingURL=drift-detector.d.ts.map