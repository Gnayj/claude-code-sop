import { ThreadState, type DesignDocFileState, type ProviderKind, type RoundHistoryEntry } from "./types.js";
export interface ThreadManagerOptions {
    sessionsDir: string;
    archiveDir: string;
    lockTimeoutSeconds: number;
}
export declare class ThreadLockTimeoutError extends Error {
    readonly designId: string;
    readonly waitedMs: number;
    constructor(designId: string, waitedMs: number);
}
export declare class ThreadManager {
    private readonly opts;
    constructor(opts: ThreadManagerOptions);
    statePath(designId: string): string;
    lockPath(designId: string): string;
    exists(designId: string): boolean;
    read(designId: string): ThreadState | null;
    /** Atomic write via tmp + rename. */
    write(state: ThreadState): void;
    /** Move state file + history into archive_dir; returns archived path. */
    archive(designId: string): string | null;
    /**
     * Acquire an advisory file lock by exclusive-create; poll up to lock_timeout_seconds.
     * Returns a release callback.
     */
    acquireLock(designId: string): () => void;
    /**
     * Initialize a fresh state record for a new thread.
     * Caller is responsible for calling `write()` after populating.
     */
    newState(designId: string, threadId: string, providerKind?: ProviderKind): ThreadState;
    /** Convenience: append round history + bump round counter. */
    recordRound(state: ThreadState, entry: RoundHistoryEntry): ThreadState;
    /** Update per-file design doc sha map. */
    updateDesignDocFiles(state: ThreadState, files: Record<string, DesignDocFileState>): ThreadState;
}
//# sourceMappingURL=thread-manager.d.ts.map