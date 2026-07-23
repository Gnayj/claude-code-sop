// Kernel advisory flock(2) locks via util-linux `flock` on an inherited descriptor (design
// ccsop-codex-implement Q17; replaces the v1 rename-steal protocol and its stale-generation ABA
// — deleted wholesale, no steal / heartbeat / generation counter exists).
//
// Mechanism (empirically validated 2026-07-23 on util-linux 2.37 / Node 20 / WSL2 ext4): the
// spawned `flock` child locks the file descriptor it INHERITS from this process. flock(2) locks
// belong to the OPEN FILE DESCRIPTION, which child and parent share, so when the child exits the
// lock stays held by OUR still-open fd, and the kernel releases it automatically whenever the fd
// closes — including on process death. Waiting happens inside the child (`flock -w`), awaited
// asynchronously; the event loop never blocks.
//
// Deadline contract (design r7 i_store_lock_retry_has_no_total_deadline): callers create ONE
// monotonic AcquisitionDeadline per lock SEQUENCE (design lock → artifact-store lock, including
// every release-and-retry) and pass it to every acquire in that sequence. Expiry fails
// deterministically (LockTimeoutError); an AbortSignal kills the waiting child (LockCancelledError).

import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

export class LockTimeoutError extends Error {
  constructor(lockPath: string) {
    super(`timed out acquiring lock ${lockPath} (single acquisition deadline expired)`);
    this.name = "LockTimeoutError";
  }
}

export class LockCancelledError extends Error {
  constructor(lockPath: string) {
    super(`cancelled while waiting for lock ${lockPath}`);
    this.name = "LockCancelledError";
  }
}

export class FlockUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `util-linux \`flock\` is unavailable or unusable on this system/filesystem: ${detail}. ` +
        `codex_implement requires Linux/WSL with util-linux flock and POSIX advisory-lock ` +
        `semantics on the .codex-review control root (design Q17). Install util-linux or move ` +
        `the repository to a POSIX filesystem.`,
    );
    this.name = "FlockUnavailableError";
  }
}

/** One monotonic deadline shared by every acquisition in a lock sequence (design r7). */
export interface AcquisitionDeadline {
  remainingMs(): number;
}

export function acquisitionDeadline(totalMs: number): AcquisitionDeadline {
  const deadlineAt = performance.now() + totalMs;
  return { remainingMs: () => Math.max(0, deadlineAt - performance.now()) };
}

export interface FlockHandle {
  path: string;
  /** Closes the fd — the kernel drops the lock. Idempotent. */
  release(): void;
}

/** The child inherits our lockfile fd as its fd 3 and flocks it. */
const CHILD_FD = 3;

/**
 * Startup/bootstrap capability probe (design Q17 / §4.2.F platform requirement): verifies the
 * `flock` binary exists AND can lock an inherited descriptor on the control root's filesystem.
 * Throws FlockUnavailableError with an actionable message; never returns a broken state.
 */
export function probeFlockSupport(dir: string): void {
  const probePath = join(dir, `.flock-probe.${process.pid}.${randomBytes(4).toString("hex")}`);
  let fd: number;
  try {
    fd = openSync(probePath, "a");
  } catch (err) {
    throw new FlockUnavailableError(`cannot open probe file ${probePath}: ${(err as Error).message}`);
  }
  try {
    const r = spawnSync("flock", ["-n", String(CHILD_FD)], {
      stdio: ["ignore", "ignore", "ignore", fd],
    });
    if (r.error) throw new FlockUnavailableError(`spawn failed: ${r.error.message}`);
    if (r.status !== 0) {
      throw new FlockUnavailableError(
        `probe lock attempt exited ${r.status ?? `signal ${r.signal}`}`,
      );
    }
  } finally {
    closeSync(fd);
    rmSync(probePath, { force: true });
  }
}

/**
 * Acquire an advisory flock(2) lock on `lockPath` (created if missing, never truncated).
 * Resolves with a handle whose release() closes the fd; rejects with LockTimeoutError /
 * LockCancelledError / FlockUnavailableError. Waiting is bounded by BOTH the shared deadline
 * and the abort signal — a persistent contender can only starve us until the deadline
 * (deterministic failure), never indefinitely.
 */
export async function acquireFlock(
  lockPath: string,
  deadline: AcquisitionDeadline,
  signal?: AbortSignal,
): Promise<FlockHandle> {
  if (signal?.aborted) throw new LockCancelledError(lockPath);
  const fd = openSync(lockPath, "a");
  let holding = false;
  try {
    const remainingMs = deadline.remainingMs();
    if (remainingMs <= 0) throw new LockTimeoutError(lockPath);
    // flock -w takes decimal seconds; exits 0 on acquire, 1 on timeout.
    const waitSecs = Math.max(0.05, remainingMs / 1000).toFixed(2);
    const acquired = await new Promise<boolean>((resolvePromise, rejectPromise) => {
      const child = spawn("flock", ["-w", waitSecs, String(CHILD_FD)], {
        stdio: ["ignore", "ignore", "ignore", fd],
      });
      const onAbort = (): void => {
        child.kill("SIGKILL");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.once("error", (err) => {
        signal?.removeEventListener("abort", onAbort);
        rejectPromise(new FlockUnavailableError((err as Error).message));
      });
      child.once("exit", (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) rejectPromise(new LockCancelledError(lockPath));
        else resolvePromise(code === 0);
      });
    });
    if (!acquired) throw new LockTimeoutError(lockPath);
    holding = true;
    let released = false;
    return {
      path: lockPath,
      release: () => {
        if (released) return;
        released = true;
        try {
          closeSync(fd);
        } catch {
          /* already closed */
        }
      },
    };
  } finally {
    if (!holding) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}
