// Thread state file persistence + advisory file lock.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §4.1
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, writeFileSync, } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { ThreadState, } from "./types.js";
export class ThreadLockTimeoutError extends Error {
    designId;
    waitedMs;
    constructor(designId, waitedMs) {
        super(`thread lock timeout for design_id=${designId} after ${waitedMs}ms`);
        this.designId = designId;
        this.waitedMs = waitedMs;
        this.name = "ThreadLockTimeoutError";
    }
}
export class ThreadManager {
    opts;
    constructor(opts) {
        this.opts = opts;
        mkdirSync(opts.sessionsDir, { recursive: true });
        mkdirSync(opts.archiveDir, { recursive: true });
    }
    statePath(designId) {
        return join(this.opts.sessionsDir, `${sanitizeId(designId)}.json`);
    }
    lockPath(designId) {
        return join(this.opts.sessionsDir, `${sanitizeId(designId)}.lock`);
    }
    exists(designId) {
        return existsSync(this.statePath(designId));
    }
    read(designId) {
        const path = this.statePath(designId);
        if (!existsSync(path))
            return null;
        const raw = readFileSync(path, "utf8");
        return ThreadState.parse(JSON.parse(raw));
    }
    /** Atomic write via tmp + rename. */
    write(state) {
        const path = this.statePath(state.design_id);
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp.${process.pid}`;
        writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
        renameSync(tmp, path);
    }
    /** Move state file + history into archive_dir; returns archived path. */
    archive(designId) {
        const src = this.statePath(designId);
        if (!existsSync(src))
            return null;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const dst = resolvePath(this.opts.archiveDir, `${sanitizeId(designId)}.${ts}.json`);
        mkdirSync(dirname(dst), { recursive: true });
        renameSync(src, dst);
        return dst;
    }
    /**
     * Acquire an advisory file lock by exclusive-create; poll up to lock_timeout_seconds.
     * Returns a release callback.
     */
    acquireLock(designId) {
        const path = this.lockPath(designId);
        const startedAt = Date.now();
        const timeoutMs = this.opts.lockTimeoutSeconds * 1000;
        let fd = null;
        while (true) {
            try {
                fd = openSync(path, "wx");
                const payload = JSON.stringify({
                    pid: process.pid,
                    acquired_at: new Date().toISOString(),
                    design_id: designId,
                });
                writeSync(fd, payload);
                break;
            }
            catch (err) {
                const code = err.code;
                if (code !== "EEXIST")
                    throw err;
                if (Date.now() - startedAt > timeoutMs) {
                    throw new ThreadLockTimeoutError(designId, Date.now() - startedAt);
                }
                // Poll with bounded backoff.
                sleepSync(50);
            }
        }
        const release = () => {
            try {
                if (fd != null)
                    closeSync(fd);
            }
            catch {
                /* ignore */
            }
            try {
                unlinkSync(path);
            }
            catch (err) {
                const code = err.code;
                if (code !== "ENOENT")
                    throw err;
            }
        };
        return release;
    }
    /**
     * Initialize a fresh state record for a new thread.
     * Caller is responsible for calling `write()` after populating.
     */
    newState(designId, threadId, providerKind = "codex") {
        return {
            design_id: designId,
            thread_id: threadId,
            thread_created_at: new Date().toISOString(),
            provider_kind: providerKind,
            design_doc_files: {},
            rounds: {
                design_review: 0,
                code_review: 0,
                fix_review: 0,
                history: [],
            },
            tokens_used_estimate_total: 0,
            scope_drift_lines_total: 0,
            thread_history: [],
            context_usage_pct: 0,
            archived: false,
            lock_holder_pid: null,
            lock_acquired_at: null,
        };
    }
    /** Convenience: append round history + bump round counter. */
    recordRound(state, entry) {
        const next = JSON.parse(JSON.stringify(state));
        next.rounds.history.push(entry);
        if (entry.stage === "design")
            next.rounds.design_review = entry.round;
        else if (entry.stage === "code")
            next.rounds.code_review = entry.round;
        else if (entry.stage === "fix")
            next.rounds.fix_review = entry.round;
        next.tokens_used_estimate_total += entry.tokens_used_estimate;
        return next;
    }
    /** Update per-file design doc sha map. */
    updateDesignDocFiles(state, files) {
        const next = JSON.parse(JSON.stringify(state));
        next.design_doc_files = files;
        return next;
    }
}
function sanitizeId(designId) {
    // Disallow path separators; keep alnum / dash / underscore.
    return designId.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function sleepSync(ms) {
    const end = Date.now() + ms;
    // Block via Atomics.wait on a fresh SharedArrayBuffer — cleaner than busy loop.
    const sab = new SharedArrayBuffer(4);
    const i32 = new Int32Array(sab);
    Atomics.wait(i32, 0, 0, ms);
    if (Date.now() < end) {
        // best-effort fallback
    }
}
//# sourceMappingURL=thread-manager.js.map