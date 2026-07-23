export declare class LockTimeoutError extends Error {
    constructor(lockPath: string);
}
export declare class LockCancelledError extends Error {
    constructor(lockPath: string);
}
export declare class FlockUnavailableError extends Error {
    constructor(detail: string);
}
/** One monotonic deadline shared by every acquisition in a lock sequence (design r7). */
export interface AcquisitionDeadline {
    remainingMs(): number;
}
export declare function acquisitionDeadline(totalMs: number): AcquisitionDeadline;
export interface FlockHandle {
    path: string;
    /** Closes the fd — the kernel drops the lock. Idempotent. */
    release(): void;
}
/**
 * Startup/bootstrap capability probe (design Q17 / §4.2.F platform requirement): verifies the
 * `flock` binary exists AND can lock an inherited descriptor on the control root's filesystem.
 * Throws FlockUnavailableError with an actionable message; never returns a broken state.
 */
export declare function probeFlockSupport(dir: string): void;
/**
 * Acquire an advisory flock(2) lock on `lockPath` (created if missing, never truncated).
 * Resolves with a handle whose release() closes the fd; rejects with LockTimeoutError /
 * LockCancelledError / FlockUnavailableError. Waiting is bounded by BOTH the shared deadline
 * and the abort signal — a persistent contender can only starve us until the deadline
 * (deterministic failure), never indefinitely.
 */
export declare function acquireFlock(lockPath: string, deadline: AcquisitionDeadline, signal?: AbortSignal): Promise<FlockHandle>;
//# sourceMappingURL=locks.d.ts.map