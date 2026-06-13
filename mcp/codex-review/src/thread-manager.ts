// Thread state file persistence + advisory file lock.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §4.1

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import {
  ThreadState,
  type DesignDocFileState,
  type ProviderKind,
  type RoundHistoryEntry,
} from "./types.js";

export interface ThreadManagerOptions {
  sessionsDir: string;
  archiveDir: string;
  lockTimeoutSeconds: number;
}

export class ThreadLockTimeoutError extends Error {
  constructor(public readonly designId: string, public readonly waitedMs: number) {
    super(`thread lock timeout for design_id=${designId} after ${waitedMs}ms`);
    this.name = "ThreadLockTimeoutError";
  }
}

export class ThreadManager {
  constructor(private readonly opts: ThreadManagerOptions) {
    mkdirSync(opts.sessionsDir, { recursive: true });
    mkdirSync(opts.archiveDir, { recursive: true });
  }

  statePath(designId: string): string {
    return join(this.opts.sessionsDir, `${sanitizeId(designId)}.json`);
  }

  lockPath(designId: string): string {
    return join(this.opts.sessionsDir, `${sanitizeId(designId)}.lock`);
  }

  exists(designId: string): boolean {
    return existsSync(this.statePath(designId));
  }

  read(designId: string): ThreadState | null {
    const path = this.statePath(designId);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return ThreadState.parse(JSON.parse(raw));
  }

  /** Atomic write via tmp + rename. */
  write(state: ThreadState): void {
    const path = this.statePath(state.design_id);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp, path);
  }

  /** Move state file + history into archive_dir; returns archived path. */
  archive(designId: string): string | null {
    const src = this.statePath(designId);
    if (!existsSync(src)) return null;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dst = resolvePath(
      this.opts.archiveDir,
      `${sanitizeId(designId)}.${ts}.json`,
    );
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    return dst;
  }

  /**
   * Acquire an advisory file lock by exclusive-create; poll up to lock_timeout_seconds.
   * Returns a release callback.
   */
  acquireLock(designId: string): () => void {
    const path = this.lockPath(designId);
    const startedAt = Date.now();
    const timeoutMs = this.opts.lockTimeoutSeconds * 1000;
    let fd: number | null = null;
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
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw err;
        if (Date.now() - startedAt > timeoutMs) {
          throw new ThreadLockTimeoutError(designId, Date.now() - startedAt);
        }
        // Poll with bounded backoff.
        sleepSync(50);
      }
    }
    const release = (): void => {
      try {
        if (fd != null) closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(path);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    };
    return release;
  }

  /**
   * Initialize a fresh state record for a new thread.
   * Caller is responsible for calling `write()` after populating.
   */
  newState(
    designId: string,
    threadId: string,
    providerKind: ProviderKind = "codex",
  ): ThreadState {
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
  recordRound(state: ThreadState, entry: RoundHistoryEntry): ThreadState {
    const next: ThreadState = JSON.parse(JSON.stringify(state));
    next.rounds.history.push(entry);
    if (entry.stage === "design") next.rounds.design_review = entry.round;
    else if (entry.stage === "code") next.rounds.code_review = entry.round;
    else if (entry.stage === "fix") next.rounds.fix_review = entry.round;
    next.tokens_used_estimate_total += entry.tokens_used_estimate;
    return next;
  }

  /** Update per-file design doc sha map. */
  updateDesignDocFiles(
    state: ThreadState,
    files: Record<string, DesignDocFileState>,
  ): ThreadState {
    const next: ThreadState = JSON.parse(JSON.stringify(state));
    next.design_doc_files = files;
    return next;
  }
}

function sanitizeId(designId: string): string {
  // Disallow path separators; keep alnum / dash / underscore.
  return designId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  // Block via Atomics.wait on a fresh SharedArrayBuffer — cleaner than busy loop.
  const sab = new SharedArrayBuffer(4);
  const i32 = new Int32Array(sab);
  Atomics.wait(i32, 0, 0, ms);
  if (Date.now() < end) {
    // best-effort fallback
  }
}
