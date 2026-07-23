import { type AcquisitionDeadline, type FlockHandle } from "./locks.js";
import { type DiffBudget } from "./diff.js";
/** Read the kernel process start-time token (`/proc/<pid>/stat` field 22) — a value that is
 * stable for a process's lifetime and (with the pid) uniquely identifies a process instance
 * across PID reuse (code r4 `c_pid_epoch_liveness`). Returns null when the pid does not exist or
 * `/proc` is unavailable. The `comm` field (2) can contain spaces and parens, so we split AFTER
 * the last `)`: the remainder begins at field 3 (state), making starttime index 22-3 = 19. */
export declare function readProcStartToken(pid: number): string | null;
/** Process epoch: identifies THIS server instance in dispatch records. */
export declare const PROCESS_EPOCH_STARTED_AT: string;
/** Kernel start-time token for THIS server process (null if `/proc` is unreadable — then epoch
 * checks degrade to PID-only liveness, the v1 behavior). */
export declare const PROCESS_EPOCH_START_TOKEN: string | null;
export declare function sha256(bytes: Buffer): string;
export declare class ControlRootViolation extends Error {
    constructor(msg: string);
}
/** Resolve `<repoRoot>/.codex-review/<...segments>` refusing ANY symlink component (existing
 * components must be real directories; missing ones are created). Called immediately before
 * every control-root operation. Residual check-then-use window: design Q15 boundary. */
export declare function resolveControlDir(repoRoot: string, segments: readonly string[]): string;
/** Server-private resource root (§4.2.F): ALL per-dispatch server state lives here — NEVER
 * under the OS temp dir. Idempotent control-plane bootstrap (exempt from reserve-first). */
export declare function resourceRoot(repoRoot: string): string;
export interface DispatchResources {
    base: string;
    scratch: string;
    home: string;
    snapBlobs: string;
    capBlobs: string;
}
/** Per-dispatch resource paths — a PURE FUNCTION of the artifact-id (design §4.2.E
 * reserve-first): recovery and GC derive them; nothing ever trusts a path read from state. */
export declare function dispatchResourcePaths(repoRoot: string, artifactId: string): DispatchResources;
/** Allocate the per-dispatch resource dirs — call ONLY after the reserve record is durable. */
export declare function allocateDispatchResources(repoRoot: string, artifactId: string): DispatchResources;
export declare function discardDispatchResources(repoRoot: string, artifactId: string): void;
/** Q17/§4.2.F platform probe — once per process, against the resource root's filesystem. */
export declare function ensureFlockSupport(repoRoot: string): void;
export declare class UnsafePathError extends Error {
    constructor(msg: string);
}
/** Content-addressed on-disk blob store rooted at an EXPLICIT directory under the per-dispatch
 * resource base (§4.2.F — never the OS temp dir). Bytes are spooled once at inventory time and
 * re-read (bounded, per-blob) only for gate checks / patch materialization. */
export declare class BlobStore {
    readonly dir: string;
    constructor(dir: string);
    pathOf(sha: string): string;
    has(sha: string): boolean;
    read(sha: string): Buffer;
    /** Read + re-verify content hash (tamper tripwire — design §4.2 step 3). */
    readVerified(sha: string): Buffer;
    copyTo(sha: string, target: string): void;
    discard(): void;
}
export interface SpooledRead {
    mode: "100644" | "100755";
    size: number;
    sha: string;
}
/**
 * Single-read-to-store discipline: no-follow component walk → O_NOFOLLOW final open → fstat
 * identity + regular-file check on the OPEN fd → ONE chunked pass that both hashes and spools
 * to the blob store. The sha ALWAYS names exactly the spooled bytes; the source path is never
 * reopened.
 */
export declare function readFileToStore(root: string, relPath: string, store: BlobStore): SpooledRead;
export type NonRegularKind = "symlink" | "dir" | "gitlink" | "other";
export type EntryState = {
    state: "present";
    kind: "file";
    mode: "100644" | "100755";
    sha: string;
    size: number;
} | {
    state: "present";
    kind: NonRegularKind;
} | {
    state: "absent";
};
export interface Snapshot {
    /** Path → state for every snapshot-domain member (post topology pruning). */
    inventory: Map<string, EntryState>;
    /** On-disk sealed byte store for every present regular file. */
    store: BlobStore;
    /** Opaque roots (design r7): nonregular non-absent paths — never materialized; absence in
     * capture is UNCHANGED; any captured presence at/below one is a violation. */
    opaqueRoots: Set<string>;
}
export interface TrackedEntry {
    path: string;
    /** Index mode string (e.g. "100644", "120000", "160000"). */
    mode: string;
    stage: number;
}
/** Parse `git ls-files --stage -z` (read-only): "mode SP sha SP stage TAB path NUL". The stage
 * listing types mode-160000 gitlinks — which lstat cannot (design Q21). */
export declare function listTrackedWithStage(repoRoot: string): TrackedEntry[];
export interface SnapshotDomain {
    paths: string[];
    gitlinkPaths: Set<string>;
    unmergedPaths: string[];
}
/** Enumerate the snapshot domain: tracked ∪ untracked-non-ignored ∪ allowlist. Git is used
 * READ-ONLY, path/stage listing only. */
export declare function enumerateSnapshotDomain(repoRoot: string, allowlist: readonly string[]): SnapshotDomain;
export interface TopologyRejection {
    reason: string;
}
export interface SnapshotResult {
    snapshot: Snapshot;
    /** Non-empty ⇒ the dispatch MUST be rejected pre-spawn (design r7 topology pass). */
    rejections: TopologyRejection[];
}
/** Raw no-follow single-read typed byte snapshot of the domain into `store`, plus the pre-spawn
 * topology pass (design r7 c_nonmaterialized_path_topology_has_no_baseline_semantics):
 * unmerged index stages reject; nonregular non-absent paths become opaque roots; opaque-root
 * descendants are pruned; allowlist entries at/below an opaque root reject. */
export declare function buildSnapshot(repoRoot: string, allowlist: readonly string[], store: BlobStore): SnapshotResult;
export interface ScratchWorkspace {
    root: string;
    discard(): void;
}
/** Materialize the snapshot into the per-dispatch scratch dir + an ergonomic (untrusted)
 * scratch git baseline commit. All bytes come from the sealed blob store (never the caller
 * worktree). Only regular files materialize; gitlink paths and their subtrees never do (Q21). */
export declare function materializeScratch(snapshot: Snapshot, scratchRoot: string): ScratchWorkspace;
/** One pass, no-follow single-read-to-store, skipping `.git` — the SINGLE byte set feeding
 * validation AND the patch. Directories are recorded ONLY when they sit at an opaque root
 * (captured presence there is a violation); otherwise they are structure. */
export declare function sealCapture(scratchRoot: string, store: BlobStore, opaqueRoots?: ReadonlySet<string>): Snapshot;
export interface Delta {
    path: string;
    op: "create" | "modify" | "delete";
}
export interface ValidationResult {
    ok: boolean;
    deltas: Delta[];
    violations: string[];
}
export declare function validateCapture(snapshot: Snapshot, capture: Snapshot, allowlist: readonly string[], maxFileBytes: number): ValidationResult;
export interface FileChangeFact {
    path: string;
    op: Delta["op"];
    mode_before: string | null;
    mode_after: string | null;
    sha_before: string | null;
    sha_after: string | null;
    added: number;
    removed: number;
}
export interface GeneratedPatch {
    /** Git-format patch bytes — NEVER decoded to a JS string. */
    patch: Buffer;
    diffstat: {
        files: number;
        added: number;
        removed: number;
    };
    filesChanged: FileChangeFact[];
}
/** Build the git-format patch ENTIRELY in server code from the sealed byte sets (Q18): no git
 * command participates, so in-content .gitattributes are inert. Every blob read re-verifies its
 * sealed hash (tamper tripwire). Bounded per the diff budget; falls back deterministically to a
 * whole-file replacement hunk. */
export declare function generatePatch(snapshot: Snapshot, capture: Snapshot, deltas: readonly Delta[], budget?: DiffBudget): GeneratedPatch;
export interface PublishedArtifact {
    artifactId: string;
    patchPath: string;
    reportPath: string;
    patchSha: string;
    patchSize: number;
    reportSha: string;
    reportSize: number;
}
export declare function newArtifactId(): string;
/** Publish patch (bytes) + report under dispatches/ with fsync-before-completed ordering.
 * MUST be called while holding the per-design lock; acquires the artifact-store lock
 * (strict design→store order — §4.2.E). */
export declare function publishArtifact(repoRoot: string, artifactId: string, patch: Buffer, report: unknown, deadline: AcquisitionDeadline, signal?: AbortSignal): Promise<PublishedArtifact>;
export type DispatchLifecycle = "reserved" | "executing" | "completed" | "failed";
export interface DispatchRecord {
    dispatch_key: string;
    payload_sha: string;
    artifact_id: string;
    round: number;
    lifecycle: DispatchLifecycle;
    epoch_pid: number;
    epoch_started_at: string;
    /** Kernel start-time token of the creating server process (code r4 `c_pid_epoch_liveness`):
     * paired with epoch_pid it survives PID reuse. Optional for legacy records (PID-only). */
    epoch_start_token?: string;
    /** Per-dispatch writer thread id — audit only (design Q16: fresh thread per dispatch). */
    thread_id?: string;
    failure_reason?: string;
    result?: unknown;
    patch_sha?: string;
    patch_size?: number;
    report_sha?: string;
    report_size?: number;
}
export interface ImplementSessionState {
    design_id: string;
    tool_class: "implement";
    rounds: number;
    tokens_used_estimate_total: number;
    codex_failure_streak: number;
    parser_failure_streak: number;
    /** Serialized as an ARRAY: dispatch keys are arbitrary Unicode ("__proto__", …) and must
     * never hit object prototypes. */
    dispatches: DispatchRecord[];
}
export declare function getDispatch(state: ImplementSessionState, key: string): DispatchRecord | undefined;
/** Versioned, field-tagged, length-prefixed payload identity. */
export declare function computePayloadSha(fields: {
    workOrder: string;
    canonicalAllowlist: readonly string[];
    cardSha: string;
    previousFindings: unknown;
}): string;
/** Canonical JSON: object keys sorted recursively — reordered-but-equal inputs hash equal. */
export declare function canonicalJson(value: unknown): string;
export declare function validateDispatchKey(key: string): string | null;
export declare function isPidAlive(pid: number): boolean;
/** Epoch-identity liveness (code r4 `c_pid_epoch_liveness`): a dispatch's owning process is
 * alive ONLY if a process with its pid exists AND that process's kernel start-time token still
 * matches the one recorded at reserve time. PID reuse (an unrelated live process inheriting a
 * dead server's pid) therefore reads as DEAD — a stale reserved/executing record is reclaimed
 * instead of wedging same-key retries and leaking residue. A record with no recorded token
 * (legacy) degrades to PID-only liveness. */
export declare function isEpochAlive(pid: number, startToken?: string | null): boolean;
/** Collision-free design-id filename encoding: [A-Za-z0-9.-] kept verbatim; EVERYTHING else
 * (incl. "_") → `_x<hex>` per UTF-8 byte — injective, distinct ids never share a state file. */
export declare function encodeDesignIdForFilename(designId: string): string;
export declare class ImplementStore {
    private readonly repoRoot;
    /** State + locks live under the control root ONLY (`.codex-review/implement-state`, design
     * §4.2.E), resolved no-follow immediately before each operation. */
    constructor(repoRoot: string);
    private stateDir;
    private statePath;
    /** Per-design transaction lock (kernel flock, Q17) — serializes the full
     * lookup/reserve/execute/finalize flow. Strict hierarchy root: design → store. */
    lock(designId: string, deadline: AcquisitionDeadline, signal?: AbortSignal): Promise<FlockHandle>;
    read(designId: string): ImplementSessionState | null;
    private readStateFile;
    newState(designId: string): ImplementSessionState;
    /** Durable state transaction (design §4.2.E): exclusive-create recognizable `*.tmp.*` →
     * write → fsync(file) → rename → fsync(dir). Call while holding the design lock. */
    write(state: ImplementSessionState): void;
    /** Enumerate every implement-state file (all designs) — used by global GC predicates.
     * `complete=false` when ANY state file was unreadable: ownership knowledge is then partial,
     * and recordless-reaping MUST be disabled (an unreadable owner is not a missing owner). */
    private readAllStates;
    /** Reap crash-orphaned state-transaction temps (`*.tmp.*` in implement-state/). */
    private reapStateTmpOrphans;
    /**
     * Startup/next-call recovery + object-class GC (design §4.2.E / Q20). Call while holding the
     * per-design lock (this design). Steps:
     *   1. `*.tmp.*` state-transaction orphans reaped.
     *   2. THIS design's nonterminal dead-epoch records → failed (interrupted), reserved rounds
     *      kept consumed, derived resources discarded.
     *   3. Working residue (tmp/<artifact-id>/, ALL designs): reaped when its record is terminal
     *      OR its epoch is provably dead; recordless residue reaped.
     *   4. Published artifacts (dispatches/, under the store lock): reaped ONLY when the owning
     *      record is terminal-failed or recordless — a completed artifact is NEVER epoch-reaped.
     */
    recoverAndGc(designId: string, deadline: AcquisitionDeadline, signal?: AbortSignal): Promise<ImplementSessionState | null>;
    /** Working-residue GC (Q20): terminal OR dead-epoch; recordless residue reaped only when
     * ownership knowledge is complete. Derived paths only — nothing is ever trusted from state. */
    private gcResidue;
    /** Published-artifact GC (Q20): ONLY terminal-failed or recordless; never epoch-reaped while
     * completed. Serializes with publication on the store lock (design→store order: the caller
     * holds the design lock). */
    private gcPublishedArtifacts;
}
export interface WriterEnvironment {
    codexHome: string;
    /** Full replacement env for the Codex SDK (no inheritance of process.env). Git is neutralized
     * here too: HOME points INSIDE the isolated dir and global/system git config are voided. */
    env: Record<string, string>;
    /** CLI `--config` overrides mirroring the file config (defense in depth — the SDK flattens
     * these into `--config key=value`, which overrides any file state). */
    cliConfigOverrides: Record<string, unknown>;
    /** Capability + sandbox attestation facts, parsed back from the WRITTEN config (test-pinned;
     * design §4.2.C + §4.2.F: a missing exclusion ⇒ the dispatch hard-fails before spawn). */
    attestation: {
        mcpServers: number;
        plugins: number;
        excludeSlashTmp: boolean;
        excludeTmpdirEnvVar: boolean;
        model?: string;
        effort?: string;
        configPath: string;
    };
    discard(): void;
}
/** Build the dedicated minimal CODEX_HOME at the DERIVED per-dispatch location (§4.2.F): auth
 * material copied from the user's real home (if present), plus a server-authored config.toml
 * with ZERO mcp_servers/plugins and the sandbox tmp-write exclusions (Q19). */
export declare function buildWriterEnvironment(homeDir: string, model?: string, effort?: string): WriterEnvironment;
//# sourceMappingURL=implement-workspace.d.ts.map