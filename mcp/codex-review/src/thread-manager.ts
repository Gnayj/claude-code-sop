// Thread state file persistence + advisory file lock.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §4.1

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
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

export interface ParserFailureRawArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export const PARSER_FAILURE_RAW_MAX_FILES_PER_DESIGN = 3;
export const PARSER_FAILURE_RAW_MAX_BYTES_PER_DESIGN = 5 * 1024 * 1024;

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
    ensurePrivateDirectoryIgnore(opts.sessionsDir);
    ensurePrivateDirectoryIgnore(opts.archiveDir);
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
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    mkdirSync(this.opts.archiveDir, { recursive: true });
    for (const rawPath of this.parserFailureRawPaths(designId)) {
      renameSync(rawPath, resolvePath(this.opts.archiveDir, basename(rawPath)));
    }
    if (!existsSync(src)) return null;
    const dst = resolvePath(this.opts.archiveDir, `${sanitizeId(designId)}.${ts}.json`);
    renameSync(src, dst);
    return dst;
  }

  /** Persist the complete provider text for a real parser rejection. Artifacts are local-only,
   * private, bounded per design_id, and move with the state during archive(). */
  recordParserFailureRaw(
    designId: string,
    stage: string,
    raw: string,
  ): ParserFailureRawArtifact {
    const bytes = Buffer.from(raw, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stem =
      `${sanitizeId(designId)}.${sanitizeId(stage)}.parser-failure.${timestamp}.${sha256.slice(0, 8)}`;
    let finalPath = resolvePath(this.opts.sessionsDir, `${stem}.raw.txt`);
    let collision = 0;
    while (existsSync(finalPath)) {
      collision += 1;
      finalPath = resolvePath(this.opts.sessionsDir, `${stem}.${collision}.raw.txt`);
    }
    const tmpPath = `${finalPath}.tmp.${process.pid}`;
    const fd = openSync(tmpPath, "wx", 0o600);
    let writeError: unknown = null;
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (written <= 0) throw new Error(`short write at byte ${offset}/${bytes.length}`);
        offset += written;
      }
      fsyncSync(fd);
    } catch (error) {
      writeError = error;
    } finally {
      closeSync(fd);
    }
    if (writeError !== null) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best effort; preserve the original write error.
      }
      throw writeError;
    }
    renameSync(tmpPath, finalPath);
    this.enforceParserFailureRawCap(designId, finalPath);
    return { path: finalPath, sha256, bytes: bytes.length };
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

  private parserFailureRawPaths(designId: string): string[] {
    const prefix = `${sanitizeId(designId)}.`;
    return readdirSync(this.opts.sessionsDir)
      .filter(
        (name) => {
          if (!name.startsWith(prefix) || !name.endsWith(".raw.txt")) return false;
          const suffix = name.slice(prefix.length);
          return /^(design|code|fix)\.parser-failure\./.test(suffix);
        },
      )
      .map((name) => resolvePath(this.opts.sessionsDir, name));
  }

  private enforceParserFailureRawCap(designId: string, newestPath: string): void {
    const entries = this.parserFailureRawPaths(designId)
      .map((path) => ({ path, stat: statSync(path) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs || a.path.localeCompare(b.path));
    let total = entries.reduce((sum, entry) => sum + entry.stat.size, 0);
    while (
      entries.length > PARSER_FAILURE_RAW_MAX_FILES_PER_DESIGN ||
      (entries.length > 1 && total > PARSER_FAILURE_RAW_MAX_BYTES_PER_DESIGN)
    ) {
      // Filesystem timestamp resolution can collapse rapid writes onto the same mtime. Never
      // select the artifact just written for eviction; the cap contract always keeps newest.
      const oldestIndex = entries.findIndex((entry) => entry.path !== newestPath);
      const oldest = oldestIndex >= 0 ? entries.splice(oldestIndex, 1)[0] : undefined;
      if (!oldest) break;
      unlinkSync(oldest.path);
      total -= oldest.stat.size;
    }
  }
}

function sanitizeId(designId: string): string {
  // Disallow path separators; keep alnum / dash / underscore.
  return designId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

function ensurePrivateDirectoryIgnore(dir: string): void {
  const path = join(dir, ".gitignore");
  const required = ["*", "!.gitignore"];
  if (!existsSync(path)) {
    writeFileSync(path, required.join("\n") + "\n", "utf8");
    return;
  }
  const current = readFileSync(path, "utf8");
  const lines = new Set(current.split(/\r?\n/));
  const missing = required.filter((line) => !lines.has(line));
  if (missing.length > 0) {
    writeFileSync(path, current.replace(/\s*$/, "\n") + missing.join("\n") + "\n", "utf8");
  }
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
