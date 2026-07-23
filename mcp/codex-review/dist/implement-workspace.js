// codex_implement transaction workspace — proposal mode v2 (design chain r1–r7).
//
// Spec source: docs/design/ccsop-framework/codex-implement-design.md §4.2 (filter-free raw-byte
// snapshot with typed kinds + explicit `absent`; pre-spawn topology pass with opaque roots;
// scratch writer workspace; sealed capture feeding validation AND patch generation from ONE byte
// set; GITLESS bounded patch construction (Q18); artifact-id publication under the
// no-follow-resolved control root; object-class GC (Q20)) + §4.2.C/Q11 (isolated minimal writer
// CODEX_HOME + capability attestation) + §4.2.F/Q19 (server-private resource root under the
// control root; writer tmp exclusions attested pre-spawn) + Q17 (kernel flock) + Q15/Q16/Q21.
//
// Invariants (design §6; v2):
//   * The ONLY caller-repo writes are under the control root `.codex-review/` (implement-state,
//     dispatches, tmp), whose components are re-walked no-follow immediately before every
//     operation.
//   * NOTHING server-private lives under the OS temp dir — every per-dispatch resource path is a
//     pure function of the reserved record's artifact-id under `.codex-review/tmp/` and is
//     allocated only AFTER the reserve record is durable (§4.2.E reserve-first). A static test
//     pins that implement modules contain no OS-tempdir reference.
//   * Every content read is single-read-to-disk: no-follow component walk, O_NOFOLLOW final
//     open, fstat identity + regular-file check on the OPEN fd, then ONE streaming pass that
//     simultaneously hashes and spools to a server-owned blob store. Caller paths are NEVER
//     reopened after their inventory hash is fixed; memory stays chunk-bounded.
//   * Patch bytes are Buffers end-to-end; sealed blob hashes are RE-VERIFIED at patch
//     generation (tamper tripwire — §4.2 step 3).
//   * Locks are kernel advisory flock(2) via inherited descriptors (Q17): no steal path, no
//     heartbeat, no generation counter; crash ⇒ kernel release. Strict hierarchy: design lock →
//     artifact-store lock; no reverse-order path exists.
//
// Threat-model boundary (design Q15, user-ratified; re-examined r6): Node.js exposes no
// openat()-family API. Path operations therefore use immediate pre-operation no-follow walks +
// O_NOFOLLOW final opens + fstat identity checks, which do NOT defend against an active local
// attacker racing the server's syscalls — explicitly out of the v1 threat model.
import { chmodSync, closeSync, constants as fsConstants, copyFileSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, readlinkSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync, } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { acquireFlock, probeFlockSupport, } from "./locks.js";
import { buildGitPatch } from "./diff.js";
/** Read the kernel process start-time token (`/proc/<pid>/stat` field 22) — a value that is
 * stable for a process's lifetime and (with the pid) uniquely identifies a process instance
 * across PID reuse (code r4 `c_pid_epoch_liveness`). Returns null when the pid does not exist or
 * `/proc` is unavailable. The `comm` field (2) can contain spaces and parens, so we split AFTER
 * the last `)`: the remainder begins at field 3 (state), making starttime index 22-3 = 19. */
export function readProcStartToken(pid) {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const rparen = stat.lastIndexOf(")");
        if (rparen < 0)
            return null;
        const after = stat.slice(rparen + 2).split(" ");
        const starttime = after[19];
        return starttime && /^\d+$/.test(starttime) ? starttime : null;
    }
    catch {
        return null;
    }
}
/** Process epoch: identifies THIS server instance in dispatch records. */
export const PROCESS_EPOCH_STARTED_AT = new Date().toISOString();
/** Kernel start-time token for THIS server process (null if `/proc` is unreadable — then epoch
 * checks degrade to PID-only liveness, the v1 behavior). */
export const PROCESS_EPOCH_START_TOKEN = readProcStartToken(process.pid);
// ---------- shared small helpers ----------
export function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
/** Environment for READ-ONLY git invocations in caller context: config/hooks/fsmonitor
 * neutralized so no clean/smudge/process filter, LFS, hook, or fsmonitor daemon can ever
 * execute (design §4.2 step 1 / Q12). Also used for the scratch's ergonomic git. */
function isolatedGitEnv() {
    return {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
    };
}
const GIT_NEUTRAL_FLAGS = [
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.fsmonitor=false",
];
function git(cwd, args) {
    return execFileSync("git", [...GIT_NEUTRAL_FLAGS, ...args], {
        cwd,
        env: isolatedGitEnv(),
        maxBuffer: 256 * 1024 * 1024,
    });
}
// ---------- control root + server-private resource root (design §4.2.E / §4.2.F) ----------
export class ControlRootViolation extends Error {
    constructor(msg) {
        super(msg);
        this.name = "ControlRootViolation";
    }
}
/** Resolve `<repoRoot>/.codex-review/<...segments>` refusing ANY symlink component (existing
 * components must be real directories; missing ones are created). Called immediately before
 * every control-root operation. Residual check-then-use window: design Q15 boundary. */
export function resolveControlDir(repoRoot, segments) {
    let current = resolvePath(repoRoot);
    for (const segment of [".codex-review", ...segments]) {
        current = join(current, segment);
        let st;
        try {
            st = lstatSync(current);
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
            mkdirSync(current);
            continue;
        }
        if (st.isSymbolicLink()) {
            throw new ControlRootViolation(`control-state path component is a symlink (refusing to follow): ${current} -> ${readlinkSync(current)}`);
        }
        if (!st.isDirectory()) {
            throw new ControlRootViolation(`control-state path component is not a directory: ${current}`);
        }
    }
    return current;
}
/** Server-private resource root (§4.2.F): ALL per-dispatch server state lives here — NEVER
 * under the OS temp dir. Idempotent control-plane bootstrap (exempt from reserve-first). */
export function resourceRoot(repoRoot) {
    return resolveControlDir(repoRoot, ["tmp"]);
}
const ARTIFACT_ID_RE = /^[0-9a-f]{32}$/;
/** Per-dispatch resource paths — a PURE FUNCTION of the artifact-id (design §4.2.E
 * reserve-first): recovery and GC derive them; nothing ever trusts a path read from state. */
export function dispatchResourcePaths(repoRoot, artifactId) {
    if (!ARTIFACT_ID_RE.test(artifactId)) {
        throw new Error(`invalid artifact id (not 32 hex): ${JSON.stringify(artifactId)}`);
    }
    const base = join(resourceRoot(repoRoot), artifactId);
    return {
        base,
        scratch: join(base, "scratch"),
        home: join(base, "home"),
        snapBlobs: join(base, "snapblobs"),
        capBlobs: join(base, "capblobs"),
    };
}
/** Allocate the per-dispatch resource dirs — call ONLY after the reserve record is durable. */
export function allocateDispatchResources(repoRoot, artifactId) {
    const paths = dispatchResourcePaths(repoRoot, artifactId);
    for (const dir of [paths.base, paths.scratch, paths.home, paths.snapBlobs, paths.capBlobs]) {
        mkdirSync(dir, { mode: 0o700 });
    }
    return paths;
}
export function discardDispatchResources(repoRoot, artifactId) {
    rmSync(dispatchResourcePaths(repoRoot, artifactId).base, { recursive: true, force: true });
}
let flockProbed = false;
/** Q17/§4.2.F platform probe — once per process, against the resource root's filesystem. */
export function ensureFlockSupport(repoRoot) {
    if (flockProbed)
        return;
    probeFlockSupport(resourceRoot(repoRoot));
    flockProbed = true;
}
// ---------- single-read no-follow content access spooled to a blob store ----------
export class UnsafePathError extends Error {
    constructor(msg) {
        super(msg);
        this.name = "UnsafePathError";
    }
}
/** Verify every intermediate component of root/relPath is a real directory (no symlinks). */
function assertNoFollowComponents(root, relPath) {
    const segments = relPath.split("/");
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
        current = join(current, segments[i]);
        const st = lstatSync(current); // throws ENOENT if missing
        if (st.isSymbolicLink()) {
            throw new UnsafePathError(`symlink component in path: ${current}`);
        }
        if (!st.isDirectory()) {
            throw new UnsafePathError(`non-directory component in path: ${current}`);
        }
    }
}
/** Content-addressed on-disk blob store rooted at an EXPLICIT directory under the per-dispatch
 * resource base (§4.2.F — never the OS temp dir). Bytes are spooled once at inventory time and
 * re-read (bounded, per-blob) only for gate checks / patch materialization. */
export class BlobStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    pathOf(sha) {
        return join(this.dir, sha);
    }
    has(sha) {
        try {
            lstatSync(this.pathOf(sha));
            return true;
        }
        catch {
            return false;
        }
    }
    read(sha) {
        return readFileSync(this.pathOf(sha));
    }
    /** Read + re-verify content hash (tamper tripwire — design §4.2 step 3). */
    readVerified(sha) {
        const bytes = this.read(sha);
        const actual = sha256(bytes);
        if (actual !== sha) {
            throw new Error(`sealed blob hash mismatch (tamper tripwire): expected ${sha}, got ${actual}`);
        }
        return bytes;
    }
    copyTo(sha, target) {
        copyFileSync(this.pathOf(sha), target);
    }
    discard() {
        rmSync(this.dir, { recursive: true, force: true });
    }
}
/**
 * Single-read-to-store discipline: no-follow component walk → O_NOFOLLOW final open → fstat
 * identity + regular-file check on the OPEN fd → ONE chunked pass that both hashes and spools
 * to the blob store. The sha ALWAYS names exactly the spooled bytes; the source path is never
 * reopened.
 */
export function readFileToStore(root, relPath, store) {
    assertNoFollowComponents(root, relPath);
    const full = join(root, relPath);
    const pre = lstatSync(full);
    if (pre.isSymbolicLink())
        throw new UnsafePathError(`symlink final component: ${full}`);
    const fd = openSync(full, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const spool = join(store.dir, `.spool.${process.pid}.${randomBytes(4).toString("hex")}`);
    const out = openSync(spool, "wx");
    try {
        const st = fstatSync(fd);
        if (!st.isFile())
            throw new UnsafePathError(`not a regular file after open: ${full}`);
        if (st.dev !== pre.dev || st.ino !== pre.ino) {
            throw new UnsafePathError(`file identity changed between lstat and open: ${full}`);
        }
        const hash = createHash("sha256");
        const buf = Buffer.alloc(64 * 1024);
        let size = 0;
        for (;;) {
            const n = readSync(fd, buf, 0, buf.length, null);
            if (n <= 0)
                break;
            hash.update(buf.subarray(0, n));
            writeSync(out, buf, 0, n);
            size += n;
        }
        const sha = hash.digest("hex");
        closeSync(out);
        try {
            renameSync(spool, store.pathOf(sha)); // idempotent content-addressing (same bytes)
        }
        catch (err) {
            unlinkSync(spool);
            throw err;
        }
        return { mode: st.mode & 0o100 ? "100755" : "100644", size, sha };
    }
    catch (err) {
        try {
            closeSync(out);
        }
        catch {
            /* already closed */
        }
        rmSync(spool, { force: true });
        throw err;
    }
    finally {
        closeSync(fd);
    }
}
/** Parse `git ls-files --stage -z` (read-only): "mode SP sha SP stage TAB path NUL". The stage
 * listing types mode-160000 gitlinks — which lstat cannot (design Q21). */
export function listTrackedWithStage(repoRoot) {
    const raw = git(repoRoot, ["ls-files", "--stage", "-z"]).toString("utf8");
    const out = [];
    for (const chunk of raw.split("\0")) {
        if (chunk.length === 0)
            continue;
        const tab = chunk.indexOf("\t");
        if (tab < 0)
            continue;
        const meta = chunk.slice(0, tab).split(" ");
        const path = chunk.slice(tab + 1);
        if (meta.length < 3 || path.length === 0)
            continue;
        out.push({ path, mode: meta[0], stage: Number(meta[2]) });
    }
    return out;
}
/** Enumerate the snapshot domain: tracked ∪ untracked-non-ignored ∪ allowlist. Git is used
 * READ-ONLY, path/stage listing only. */
export function enumerateSnapshotDomain(repoRoot, allowlist) {
    const tracked = listTrackedWithStage(repoRoot);
    const gitlinkPaths = new Set();
    const unmerged = new Set();
    const domain = new Set();
    for (const e of tracked) {
        domain.add(e.path);
        if (e.mode === "160000")
            gitlinkPaths.add(e.path);
        if (e.stage !== 0)
            unmerged.add(e.path);
    }
    const untracked = git(repoRoot, ["ls-files", "-zo", "--exclude-standard"]).toString("utf8");
    for (const p of untracked.split("\0")) {
        if (p.length > 0)
            domain.add(p);
    }
    for (const p of allowlist)
        domain.add(p);
    return { paths: [...domain].sort(), gitlinkPaths, unmergedPaths: [...unmerged].sort() };
}
function statPathToStore(root, path, store, gitlinkPaths) {
    // Q21: the staged index is authoritative for the gitlink kind — lstat sees an initialized
    // submodule as a directory and an uninitialized one as absent; never ask it.
    if (gitlinkPaths.has(path))
        return { state: "present", kind: "gitlink" };
    let st;
    try {
        assertNoFollowComponents(root, path);
        st = lstatSync(join(root, path));
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT" || code === "ENOTDIR")
            return { state: "absent" };
        if (err instanceof UnsafePathError)
            return { state: "present", kind: "other" };
        throw err;
    }
    if (st.isFile()) {
        const r = readFileToStore(root, path, store);
        return { state: "present", kind: "file", mode: r.mode, sha: r.sha, size: r.size };
    }
    if (st.isSymbolicLink())
        return { state: "present", kind: "symlink" };
    if (st.isDirectory())
        return { state: "present", kind: "dir" }; // opaque root (r7), not absent
    return { state: "present", kind: "other" };
}
function isEqualOrBelow(path, root) {
    return path === root || path.startsWith(`${root}/`);
}
/** Raw no-follow single-read typed byte snapshot of the domain into `store`, plus the pre-spawn
 * topology pass (design r7 c_nonmaterialized_path_topology_has_no_baseline_semantics):
 * unmerged index stages reject; nonregular non-absent paths become opaque roots; opaque-root
 * descendants are pruned; allowlist entries at/below an opaque root reject. */
export function buildSnapshot(repoRoot, allowlist, store) {
    const domain = enumerateSnapshotDomain(repoRoot, allowlist);
    const rejections = [];
    for (const p of domain.unmergedPaths) {
        rejections.push({ reason: `unmerged index entry (nonzero stage): ${p}` });
    }
    const inventory = new Map();
    for (const path of domain.paths) {
        inventory.set(path, statPathToStore(repoRoot, path, store, domain.gitlinkPaths));
    }
    const opaqueRoots = new Set();
    for (const [path, entry] of inventory) {
        if (entry.state === "present" && entry.kind !== "file")
            opaqueRoots.add(path);
    }
    // Prune descendants of opaque roots from the domain (inside the opaque zone).
    for (const path of [...inventory.keys()]) {
        for (const root of opaqueRoots) {
            if (path !== root && isEqualOrBelow(path, root)) {
                inventory.delete(path);
                break;
            }
        }
    }
    // Allowlist entries equal to or below an opaque root reject pre-spawn (component-prefix).
    for (const entry of allowlist) {
        for (const root of opaqueRoots) {
            if (isEqualOrBelow(entry, root)) {
                const kind = inventory.get(root)?.state === "present"
                    ? inventory.get(root).kind
                    : "opaque";
                rejections.push({
                    reason: entry === root
                        ? `allowlist entry is a non-regular path (${kind}) — unsatisfiable under the text-only contract: ${entry}`
                        : `allowlist entry lies below an opaque ${kind} root (${root}): ${entry}`,
                });
                break;
            }
        }
    }
    return { snapshot: { inventory, store, opaqueRoots }, rejections };
}
/** Materialize the snapshot into the per-dispatch scratch dir + an ergonomic (untrusted)
 * scratch git baseline commit. All bytes come from the sealed blob store (never the caller
 * worktree). Only regular files materialize; gitlink paths and their subtrees never do (Q21). */
export function materializeScratch(snapshot, scratchRoot) {
    const root = scratchRoot;
    for (const [path, entry] of snapshot.inventory) {
        if (entry.state !== "present" || entry.kind !== "file")
            continue;
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        snapshot.store.copyTo(entry.sha, target);
        chmodSync(target, entry.mode === "100755" ? 0o755 : 0o644);
    }
    const scratchEnv = {
        ...isolatedGitEnv(),
        GIT_AUTHOR_NAME: "ccsop-writer",
        GIT_AUTHOR_EMAIL: "writer@ccsop.invalid",
        GIT_COMMITTER_NAME: "ccsop-writer",
        GIT_COMMITTER_EMAIL: "writer@ccsop.invalid",
    };
    const sgit = (args) => execFileSync("git", args, { cwd: root, env: scratchEnv, maxBuffer: 64 * 1024 * 1024 });
    sgit(["init", "-q"]);
    // Persisted local settings — effective for the writer's own git invocations.
    sgit(["config", "core.autocrlf", "false"]);
    sgit(["config", "core.hooksPath", "/dev/null"]);
    sgit(["config", "core.fsmonitor", "false"]);
    sgit(["config", "user.name", "ccsop-writer"]);
    sgit(["config", "user.email", "writer@ccsop.invalid"]);
    sgit(["add", "-A"]);
    sgit(["commit", "-q", "--allow-empty", "-m", "ccsop implement baseline (synthetic root)"]);
    return {
        root,
        discard: () => rmSync(root, { recursive: true, force: true }),
    };
}
// ---------- sealed capture (design §4.2 step 3 / Q13) ----------
/** One pass, no-follow single-read-to-store, skipping `.git` — the SINGLE byte set feeding
 * validation AND the patch. Directories are recorded ONLY when they sit at an opaque root
 * (captured presence there is a violation); otherwise they are structure. */
export function sealCapture(scratchRoot, store, opaqueRoots = new Set()) {
    const inventory = new Map();
    const walk = (rel) => {
        const abs = rel ? join(scratchRoot, rel) : scratchRoot;
        for (const name of readdirSync(abs)) {
            const childRel = rel ? `${rel}/${name}` : name;
            if (childRel === ".git")
                continue;
            const st = lstatSync(join(scratchRoot, childRel));
            if (st.isDirectory()) {
                if (opaqueRoots.has(childRel)) {
                    inventory.set(childRel, { state: "present", kind: "dir" });
                }
                walk(childRel);
            }
            else if (st.isFile()) {
                const r = readFileToStore(scratchRoot, childRel, store);
                inventory.set(childRel, {
                    state: "present",
                    kind: "file",
                    mode: r.mode,
                    sha: r.sha,
                    size: r.size,
                });
            }
            else if (st.isSymbolicLink()) {
                inventory.set(childRel, { state: "present", kind: "symlink" });
            }
            else {
                inventory.set(childRel, { state: "present", kind: "other" });
            }
        }
    };
    walk("");
    return { inventory, store, opaqueRoots: new Set(opaqueRoots) };
}
function isNulFree(bytes) {
    return !bytes.includes(0);
}
export function validateCapture(snapshot, capture, allowlist, maxFileBytes) {
    const allowed = new Set(allowlist);
    const violations = [];
    const deltas = [];
    const paths = new Set([...snapshot.inventory.keys(), ...capture.inventory.keys()]);
    for (const path of [...paths].sort()) {
        const before = snapshot.inventory.get(path) ?? { state: "absent" };
        const after = capture.inventory.get(path) ?? { state: "absent" };
        // Opaque-root baseline semantics (design r7): absence in capture is UNCHANGED (the path was
        // never materialized — not a deletion); ANY captured presence there is a violation.
        if (snapshot.opaqueRoots.has(path)) {
            if (after.state === "present") {
                const kind = after.kind;
                violations.push(`captured presence at opaque root (never materialized): ${path} (${kind})`);
            }
            continue;
        }
        const key = (e) => e.state === "present" && e.kind === "file"
            ? `f:${e.mode}:${e.sha}`
            : e.state === "present"
                ? `x:${e.kind}`
                : "absent";
        if (key(before) === key(after))
            continue;
        const op = before.state === "absent" ? "create" : after.state === "absent" ? "delete" : "modify";
        deltas.push({ path, op });
        if (!allowed.has(path)) {
            violations.push(`out-of-allowlist ${op}: ${path}`);
            continue;
        }
        if (after.state === "present" && after.kind !== "file") {
            violations.push(`allowlisted postimage kind is not a regular file (${after.kind}) — typed violation: ${path}`);
            continue;
        }
        // Both-sides text gate (design r5). Gate byte reads are bounded: a side is only read when
        // its size is within the cap.
        for (const [label, side, inv] of [
            ["preimage", before, snapshot],
            ["postimage", after, capture],
        ]) {
            if (side.state !== "present")
                continue;
            if (side.kind !== "file") {
                violations.push(`allowlisted ${label} kind is not a regular file (${side.kind}) — typed violation: ${path}`);
                continue;
            }
            if (side.size > maxFileBytes) {
                violations.push(`${label} exceeds max_file_bytes=${maxFileBytes} (${side.size}): ${path}`);
                continue;
            }
            if (!inv.store.has(side.sha)) {
                violations.push(`${label} bytes unavailable for gate (internal): ${path}`);
                continue;
            }
            if (!isNulFree(inv.store.read(side.sha))) {
                violations.push(`${label} is binary (contains NUL): ${path}`);
            }
        }
    }
    return { ok: violations.length === 0, deltas, violations };
}
/** Build the git-format patch ENTIRELY in server code from the sealed byte sets (Q18): no git
 * command participates, so in-content .gitattributes are inert. Every blob read re-verifies its
 * sealed hash (tamper tripwire). Bounded per the diff budget; falls back deterministically to a
 * whole-file replacement hunk. */
export function generatePatch(snapshot, capture, deltas, budget = {}) {
    const fileSide = (inv, path) => {
        const e = inv.inventory.get(path);
        if (!e || e.state !== "present" || e.kind !== "file")
            return { present: false };
        return { present: true, mode: e.mode, bytes: inv.store.readVerified(e.sha) };
    };
    const entries = [...deltas]
        .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
        .map((d) => ({
        path: d.path,
        before: fileSide(snapshot, d.path),
        after: fileSide(capture, d.path),
    }));
    const built = buildGitPatch(entries, budget);
    const filesChanged = entries.map((e) => {
        const before = snapshot.inventory.get(e.path);
        const after = capture.inventory.get(e.path);
        const f = (entry) => entry && entry.state === "present" && entry.kind === "file" ? entry : null;
        const counts = built.perFile.get(e.path) ?? { added: 0, removed: 0, usedFallback: false };
        const op = !e.before.present ? "create" : !e.after.present ? "delete" : "modify";
        return {
            path: e.path,
            op,
            mode_before: f(before)?.mode ?? null,
            mode_after: f(after)?.mode ?? null,
            sha_before: f(before)?.sha ?? null,
            sha_after: f(after)?.sha ?? null,
            added: counts.added,
            removed: counts.removed,
        };
    });
    const diffstat = filesChanged.reduce((acc, f) => ({
        files: acc.files + 1,
        added: acc.added + f.added,
        removed: acc.removed + f.removed,
    }), { files: 0, added: 0, removed: 0 });
    return { patch: built.patch, diffstat, filesChanged };
}
export function newArtifactId() {
    return randomBytes(16).toString("hex");
}
function writeDurable(finalPath, bytes) {
    // Recognizable transaction temp (reaped on recovery); link() = no-overwrite publication.
    const tmp = `${finalPath}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
    const fd = openSync(tmp, "wx");
    try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    try {
        linkSync(tmp, finalPath);
    }
    finally {
        unlinkSync(tmp);
    }
    const dirFd = openSync(dirname(finalPath), "r");
    try {
        fsyncSync(dirFd);
    }
    finally {
        closeSync(dirFd);
    }
}
/** Publish patch (bytes) + report under dispatches/ with fsync-before-completed ordering.
 * MUST be called while holding the per-design lock; acquires the artifact-store lock
 * (strict design→store order — §4.2.E). */
export async function publishArtifact(repoRoot, artifactId, patch, report, deadline, signal) {
    const dir = resolveControlDir(repoRoot, ["dispatches"]);
    const lock = await acquireFlock(join(dir, ".store.lock"), deadline, signal);
    try {
        const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8");
        const patchPath = join(dir, `${artifactId}.patch`);
        const reportPath = join(dir, `${artifactId}.report.json`);
        writeDurable(patchPath, patch);
        writeDurable(reportPath, reportBytes);
        return {
            artifactId,
            patchPath,
            reportPath,
            patchSha: sha256(patch),
            patchSize: patch.length,
            reportSha: sha256(reportBytes),
            reportSize: reportBytes.length,
        };
    }
    finally {
        lock.release();
    }
}
export function getDispatch(state, key) {
    return state.dispatches.find((r) => r.dispatch_key === key);
}
/** Versioned, field-tagged, length-prefixed payload identity. */
export function computePayloadSha(fields) {
    const h = createHash("sha256");
    const put = (tag, bytes) => {
        const tagBytes = Buffer.from(tag, "utf8");
        const len = Buffer.alloc(4);
        len.writeUInt32BE(bytes.length);
        h.update(tagBytes).update(len).update(bytes);
    };
    h.update(Buffer.from("ccsop-dispatch-v1", "utf8"));
    put("allow", Buffer.from(JSON.stringify(fields.canonicalAllowlist), "utf8"));
    put("card", Buffer.from(fields.cardSha, "utf8"));
    put("order", Buffer.from(fields.workOrder, "utf8"));
    put("prev", Buffer.from(canonicalJson(fields.previousFindings ?? null), "utf8"));
    return h.digest("hex");
}
/** Canonical JSON: object keys sorted recursively — reordered-but-equal inputs hash equal. */
export function canonicalJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
export function validateDispatchKey(key) {
    const bytes = Buffer.byteLength(key, "utf8");
    if (bytes < 1 || bytes > 128)
        return `dispatch_key must be 1-128 UTF-8 bytes (got ${bytes})`;
    // Reject lone surrogates (ill-formed Unicode) — manual scan (ES2024 isWellFormed not assumed).
    for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const n = key.charCodeAt(i + 1);
            if (!(n >= 0xdc00 && n <= 0xdfff)) {
                return "dispatch_key contains ill-formed Unicode (lone high surrogate)";
            }
            i++;
        }
        else if (c >= 0xdc00 && c <= 0xdfff) {
            return "dispatch_key contains ill-formed Unicode (lone low surrogate)";
        }
    }
    return null;
}
export function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === "EPERM";
    }
}
/** Epoch-identity liveness (code r4 `c_pid_epoch_liveness`): a dispatch's owning process is
 * alive ONLY if a process with its pid exists AND that process's kernel start-time token still
 * matches the one recorded at reserve time. PID reuse (an unrelated live process inheriting a
 * dead server's pid) therefore reads as DEAD — a stale reserved/executing record is reclaimed
 * instead of wedging same-key retries and leaking residue. A record with no recorded token
 * (legacy) degrades to PID-only liveness. */
export function isEpochAlive(pid, startToken) {
    if (startToken == null)
        return isPidAlive(pid);
    const current = readProcStartToken(pid);
    if (current == null)
        return false; // no such pid → dead
    return current === startToken; // mismatch ⇒ pid reused ⇒ the original epoch is dead
}
/** Collision-free design-id filename encoding: [A-Za-z0-9.-] kept verbatim; EVERYTHING else
 * (incl. "_") → `_x<hex>` per UTF-8 byte — injective, distinct ids never share a state file. */
export function encodeDesignIdForFilename(designId) {
    let out = "";
    for (const ch of designId) {
        if (/^[A-Za-z0-9.-]$/.test(ch)) {
            out += ch;
        }
        else {
            for (const byte of Buffer.from(ch, "utf8")) {
                out += `_x${byte.toString(16).padStart(2, "0")}`;
            }
        }
    }
    return out;
}
const STATE_TMP_RE = /\.tmp\./;
export class ImplementStore {
    repoRoot;
    /** State + locks live under the control root ONLY (`.codex-review/implement-state`, design
     * §4.2.E), resolved no-follow immediately before each operation. */
    constructor(repoRoot) {
        this.repoRoot = repoRoot;
    }
    stateDir() {
        return resolveControlDir(this.repoRoot, ["implement-state"]);
    }
    statePath(designId) {
        return join(this.stateDir(), `${encodeDesignIdForFilename(designId)}.implement.json`);
    }
    /** Per-design transaction lock (kernel flock, Q17) — serializes the full
     * lookup/reserve/execute/finalize flow. Strict hierarchy root: design → store. */
    lock(designId, deadline, signal) {
        return acquireFlock(join(this.stateDir(), `${encodeDesignIdForFilename(designId)}.implement.lock`), deadline, signal);
    }
    read(designId) {
        return this.readStateFile(this.statePath(designId), designId);
    }
    readStateFile(path, expectDesignId) {
        let text;
        try {
            text = readFileSync(path, "utf8");
        }
        catch (err) {
            if (err.code === "ENOENT")
                return null;
            throw err;
        }
        const parsed = JSON.parse(text);
        if (parsed.tool_class !== "implement") {
            throw new Error(`state file ${path} is not an implement-class session (cross-class resume is prohibited)`);
        }
        if (expectDesignId !== undefined && parsed.design_id !== expectDesignId) {
            throw new Error(`state file ${path} belongs to design_id ${JSON.stringify(parsed.design_id)}, not ${JSON.stringify(expectDesignId)}`);
        }
        if (!Array.isArray(parsed.dispatches)) {
            throw new Error(`state file ${path} has a non-array dispatches field`);
        }
        return parsed;
    }
    newState(designId) {
        return {
            design_id: designId,
            tool_class: "implement",
            rounds: 0,
            tokens_used_estimate_total: 0,
            codex_failure_streak: 0,
            parser_failure_streak: 0,
            dispatches: [],
        };
    }
    /** Durable state transaction (design §4.2.E): exclusive-create recognizable `*.tmp.*` →
     * write → fsync(file) → rename → fsync(dir). Call while holding the design lock. */
    write(state) {
        const path = this.statePath(state.design_id);
        const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
        const fd = openSync(tmp, "wx");
        try {
            writeFileSync(fd, JSON.stringify(state, null, 2));
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(tmp, path);
        const dirFd = openSync(dirname(path), "r");
        try {
            fsyncSync(dirFd);
        }
        finally {
            closeSync(dirFd);
        }
    }
    /** Enumerate every implement-state file (all designs) — used by global GC predicates.
     * `complete=false` when ANY state file was unreadable: ownership knowledge is then partial,
     * and recordless-reaping MUST be disabled (an unreadable owner is not a missing owner). */
    readAllStates() {
        const dir = this.stateDir();
        const states = [];
        let complete = true;
        for (const name of readdirSync(dir)) {
            if (!name.endsWith(".implement.json"))
                continue;
            if (STATE_TMP_RE.test(name))
                continue;
            try {
                const st = this.readStateFile(join(dir, name));
                if (st)
                    states.push(st);
            }
            catch {
                complete = false; // unreadable state file — never a reason to reap anything
            }
        }
        return { states, complete };
    }
    /** Reap crash-orphaned state-transaction temps (`*.tmp.*` in implement-state/). */
    reapStateTmpOrphans() {
        const dir = this.stateDir();
        for (const name of readdirSync(dir)) {
            if (STATE_TMP_RE.test(name))
                rmSync(join(dir, name), { force: true });
        }
    }
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
    async recoverAndGc(designId, deadline, signal) {
        this.reapStateTmpOrphans();
        const state = this.read(designId);
        if (state) {
            let dirty = false;
            for (const record of state.dispatches) {
                const terminal = record.lifecycle === "completed" || record.lifecycle === "failed";
                if (!terminal && !isEpochAlive(record.epoch_pid, record.epoch_start_token)) {
                    record.lifecycle = "failed";
                    record.failure_reason = "interrupted (process epoch dead)";
                    if (record.round > state.rounds)
                        state.rounds = record.round;
                    dirty = true;
                }
            }
            if (dirty)
                this.write(state);
        }
        const all = this.readAllStates();
        this.gcResidue(all.states, all.complete);
        await this.gcPublishedArtifacts(all.states, all.complete, deadline, signal);
        return state;
    }
    /** Working-residue GC (Q20): terminal OR dead-epoch; recordless residue reaped only when
     * ownership knowledge is complete. Derived paths only — nothing is ever trusted from state. */
    gcResidue(allStates, complete) {
        const byArtifact = new Map();
        for (const st of allStates) {
            for (const r of st.dispatches)
                byArtifact.set(r.artifact_id, r);
        }
        const root = resourceRoot(this.repoRoot);
        for (const name of readdirSync(root)) {
            if (!ARTIFACT_ID_RE.test(name)) {
                // Probe temps and other recognizable server droppings; never a dispatch dir.
                if (name.startsWith(".flock-probe."))
                    rmSync(join(root, name), { force: true });
                continue;
            }
            const record = byArtifact.get(name);
            const reap = record === undefined
                ? complete
                : record.lifecycle === "completed" ||
                    record.lifecycle === "failed" ||
                    !isEpochAlive(record.epoch_pid, record.epoch_start_token);
            if (reap)
                rmSync(join(root, name), { recursive: true, force: true });
        }
    }
    /** Published-artifact GC (Q20): ONLY terminal-failed or recordless; never epoch-reaped while
     * completed. Serializes with publication on the store lock (design→store order: the caller
     * holds the design lock). */
    async gcPublishedArtifacts(allStates, complete, deadline, signal) {
        let dir;
        try {
            dir = resolveControlDir(this.repoRoot, ["dispatches"]);
        }
        catch {
            return; // control root unresolvable → GC is not safe; publication will fail loudly anyway
        }
        const lock = await acquireFlock(join(dir, ".store.lock"), deadline, signal);
        try {
            const byArtifact = new Map();
            for (const st of allStates) {
                for (const r of st.dispatches)
                    byArtifact.set(r.artifact_id, r);
            }
            for (const name of readdirSync(dir)) {
                const m = /^([0-9a-f]{32})\.(patch|report\.json)(\.tmp\..*)?$/.exec(name);
                if (!m)
                    continue;
                const record = byArtifact.get(m[1]);
                const isTxnTemp = m[3] !== undefined;
                const reap = record === undefined
                    ? complete
                    : record.lifecycle === "failed" ||
                        (isTxnTemp && !isEpochAlive(record.epoch_pid, record.epoch_start_token));
                if (reap)
                    rmSync(join(dir, name), { force: true });
            }
        }
        finally {
            lock.release();
        }
    }
}
/** Build the dedicated minimal CODEX_HOME at the DERIVED per-dispatch location (§4.2.F): auth
 * material copied from the user's real home (if present), plus a server-authored config.toml
 * with ZERO mcp_servers/plugins and the sandbox tmp-write exclusions (Q19). */
export function buildWriterEnvironment(homeDir, model, effort) {
    const codexHome = homeDir;
    const realHome = process.env.CODEX_HOME || join(process.env.HOME ?? "", ".codex");
    for (const authFile of ["auth.json"]) {
        try {
            const bytes = readFileSync(join(realHome, authFile));
            writeFileSync(join(codexHome, authFile), bytes, { mode: 0o600 });
        }
        catch {
            /* no auth file — SDK may still auth via env/api key */
        }
    }
    const configLines = [
        "# ccsop implement writer config — server-authored (design ccsop-codex-implement §4.2.C/F).",
        "# Deliberately minimal: NO mcp_servers, NO plugins/connectors, NO projects trust grants.",
    ];
    if (model)
        configLines.push(`model = ${JSON.stringify(model)}`);
    if (effort)
        configLines.push(`model_reasoning_effort = ${JSON.stringify(effort)}`);
    configLines.push("", "# Q19: the codex default tmp write grants are OFF — the writer's writable world is exactly", "# the scratch subtree (sealed stores/staging are unreachable by path grant AND tmp channel).", "[sandbox_workspace_write]", "exclude_slash_tmp = true", "exclude_tmpdir_env_var = true");
    const configPath = join(codexHome, "config.toml");
    writeFileSync(configPath, configLines.join("\n") + "\n");
    const written = readFileSync(configPath, "utf8");
    const inSandboxSection = /\[sandbox_workspace_write\]([^[]*)/.exec(written)?.[1] ?? "";
    const attestation = {
        mcpServers: (written.match(/^\[mcp_servers/gm) ?? []).length,
        plugins: (written.match(/^\[plugins/gm) ?? []).length,
        excludeSlashTmp: /^\s*exclude_slash_tmp\s*=\s*true\s*$/m.test(inSandboxSection),
        excludeTmpdirEnvVar: /^\s*exclude_tmpdir_env_var\s*=\s*true\s*$/m.test(inSandboxSection),
        // Audit echo of the tier the server resolved and wrote above (not a security gate — the
        // Q19 gate covers only the sandbox facts; file contents are pinned in tests).
        model,
        effort,
        configPath,
    };
    const env = {
        CODEX_HOME: codexHome,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: codexHome,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
    };
    return {
        codexHome,
        env,
        cliConfigOverrides: {
            sandbox_workspace_write: { exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
        },
        attestation,
        discard: () => rmSync(codexHome, { recursive: true, force: true }),
    };
}
//# sourceMappingURL=implement-workspace.js.map