// §8 *adversarial* fence (design v2, r6/r7): pins code r3 (a)–(g) + i_sdk_abort_signal at the
// exact triggers the r3 No-Go named. Unit tier — the real-writer boundary probe + /tmp write
// denial live in the live-smoke tier (§4.2.F).
//
//   (a) resource-root derivation + no-OS-tempdir static scan + attestation gate + sealed-hash
//       tamper tripwire
//   (b) kernel flock: REAL two-process contention, kill -9 release, starvation deadline,
//       mid-wait cancellation, open-file-description persistence
//   (c) reserve-first: pre-reserve failure leaves zero traces; `*.tmp.*` orphan reap; only the
//       dispatch's own derived dir ever exists; clean after
//   (d) nested .gitattributes (allowlisted AND as bystander context) never transform patch bytes
//   (e) topology: unchanged tracked symlink is NOT a deletion; allowlist at/below opaque roots
//       rejects pre-spawn; gitlink typing from the staged index (initialized + uninitialized);
//       unmerged index rejects; content materialized at a gitlink path ⇒ violation
//   (f) GC ownership-knowledge completeness: unreadable state file disables recordless reaping
//   (bounds/quoting/sig) bounded diff fallback fixtures; C-style quoting apply roundtrip;
//       cancellation inside patch generation

import { describe, expect, it } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ResolvedConfig } from "../src/config.js";
import {
  ImplementStore,
  buildWriterEnvironment,
  dispatchResourcePaths,
  resolveControlDir,
  resourceRoot,
} from "../src/implement-workspace.js";
import {
  runImplementFlow,
  type ImplementFlowDependencies,
  type WriterTurnRequest,
  type WriterTurnResult,
} from "../src/run-implement-flow.js";
import {
  LockCancelledError,
  LockTimeoutError,
  acquireFlock,
  acquisitionDeadline,
} from "../src/locks.js";
import { buildGitPatch, generateFilePatch, quoteGitPath } from "../src/diff.js";
import { defaultConfig, makeTempDir, rmDir } from "./test-helpers.js";

function g(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.invalid",
    },
  }).toString("utf8");
}

function makeRepo(): { root: string; cleanup(): void } {
  const root = makeTempDir("ccsop-adv-");
  g(root, ["init", "-q"]);
  writeFileSync(join(root, "f.txt"), "one\ntwo\n");
  g(root, ["add", "-A"]);
  g(root, ["commit", "-q", "-m", "base"]);
  return { root, cleanup: () => rmDir(root) };
}

function makeCard(root: string, files: string[]): string {
  const rel = "docs/plans/active/adv-implement.txt";
  mkdirSync(join(root, "docs/plans/active"), { recursive: true });
  writeFileSync(join(root, rel), `stage: implement\n\n\`\`\`files\n${files.join("\n")}\n\`\`\`\n`);
  return rel;
}

function cfg(root: string): ResolvedConfig {
  const config = defaultConfig({
    meta: {
      project_id: "adv",
      project_name: "adv",
      language: "en",
      repo_root: root,
      allowed_doc_roots: ["docs/"],
    },
  });
  config.implement = { enabled: true, max_implement_rounds: 9, max_file_bytes: 2097152 };
  return config;
}

type Writer = (req: WriterTurnRequest) => Promise<WriterTurnResult>;

function deps(
  root: string,
  config: ResolvedConfig,
  writer: Writer,
  extra: Partial<ImplementFlowDependencies> = {},
): ImplementFlowDependencies {
  return {
    config,
    configBaseDir: root,
    store: new ImplementStore(root),
    runWriterTurn: writer,
    ...extra,
  };
}

const okText = 'done {"summary":"ok","files":[],"tests_run":[],"risks":[]}';

function input(card: string, files: string[], key: string, designId = "adv-d") {
  return { designId, taskCardPath: card, filesAllowlist: files, workOrder: "w", dispatchKey: key };
}

// ---------------------------------------------------------------------------------------------
// (a) resource root + static scan + attestation + tripwire
// ---------------------------------------------------------------------------------------------

describe("adversarial (a): server-private resource root + attestation + tripwire", () => {
  it("static scan: implement modules use NO OS-tempdir facility", () => {
    for (const rel of [
      "src/locks.ts",
      "src/diff.ts",
      "src/implement-workspace.ts",
      "src/run-implement-flow.ts",
      "src/tools/implement.ts",
    ]) {
      const text = readFileSync(join(__dirname, "..", rel), "utf8");
      expect(text, `${rel} must not import node:os`).not.toMatch(/from\s+["']node:os["']/);
      expect(text, `${rel} must not call os.tmpdir`).not.toMatch(/\btmpdir\s*\(/);
      expect(text, `${rel} must not read $TMPDIR`).not.toMatch(/process\.env\.TMPDIR/);
    }
  });

  it("every per-dispatch path derives under .codex-review/tmp/<artifact-id>", () => {
    const repo = makeRepo();
    try {
      const id = "ab".repeat(16);
      const res = dispatchResourcePaths(repo.root, id);
      const root = resourceRoot(repo.root);
      expect(root).toBe(join(repo.root, ".codex-review", "tmp"));
      for (const p of [res.base, res.scratch, res.home, res.snapBlobs, res.capBlobs]) {
        expect(p.startsWith(join(root, id))).toBe(true);
      }
      expect(() => dispatchResourcePaths(repo.root, "../evil")).toThrow(/invalid artifact id/);
      expect(() => dispatchResourcePaths(repo.root, "short")).toThrow(/invalid artifact id/);
    } finally {
      repo.cleanup();
    }
  });

  it("writer env attests BOTH tmp exclusions + carries CLI --config overrides", () => {
    const repo = makeRepo();
    try {
      const home = join(resourceRoot(repo.root), "cd".repeat(16), "home");
      mkdirSync(home, { recursive: true });
      const env = buildWriterEnvironment(home);
      expect(env.attestation.excludeSlashTmp).toBe(true);
      expect(env.attestation.excludeTmpdirEnvVar).toBe(true);
      expect(env.attestation.mcpServers).toBe(0);
      expect(env.attestation.plugins).toBe(0);
      expect(env.cliConfigOverrides).toEqual({
        sandbox_workspace_write: { exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
      });
      const written = readFileSync(env.attestation.configPath, "utf8");
      expect(written).toMatch(/^\[sandbox_workspace_write\]$/m);
      expect(written).toMatch(/^exclude_slash_tmp = true$/m);
      expect(written).toMatch(/^exclude_tmpdir_env_var = true$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("attestation gate: a missing exclusion hard-fails PRE-SPAWN (writer never runs)", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      let writerCalls = 0;
      const d = deps(repo.root, config, async () => {
        writerCalls += 1;
        return { text: okText };
      }, {
        buildWriterEnv: (homeDir, model) => {
          const env = buildWriterEnvironment(homeDir, model);
          return {
            ...env,
            attestation: { ...env.attestation, excludeSlashTmp: false },
          };
        },
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "att-gate"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/attestation failed.*pre-spawn/s);
      expect(r.lifecycle).toBe("failed");
      expect(writerCalls).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it("sealed-hash tamper tripwire: post-capture blob tamper ⇒ internal abort, no artifact", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\ntampered-run\n");
        // The scripted writer runs unsandboxed in-process: reach into the sibling sealed
        // snapshot store (in production the sandbox forbids this path grant) and flip bytes.
        const base = join(req.scratchRoot, "..");
        for (const blobDir of ["snapblobs", "capblobs"]) {
          const dir = join(base, blobDir);
          if (!existsSync(dir)) continue;
          for (const name of readdirSync(dir)) {
            if (name.startsWith(".")) continue;
            writeFileSync(join(dir, name), "EVIL BYTES\n");
          }
        }
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "tamper"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/tamper tripwire|dispatch phase failed/);
      const dispatches = join(repo.root, ".codex-review/dispatches");
      if (existsSync(dispatches)) {
        expect(readdirSync(dispatches).filter((f) => f.endsWith(".patch"))).toHaveLength(0);
      }
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (b) kernel flock: real processes, kill -9, starvation, cancellation, OFD persistence
// ---------------------------------------------------------------------------------------------

const HOLDER_SRC = `
const { openSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const fd = openSync(process.argv[1], "a");
const r = spawnSync("flock", ["-n", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
if (r.status !== 0) { console.log("ACQUIRE_FAILED"); process.exit(1); }
console.log("ACQUIRED");
setInterval(() => {}, 1000);
`;

function spawnHolder(lockPath: string): Promise<{ pid: number; kill: () => void }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["-e", HOLDER_SRC, lockPath], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes("ACQUIRED")) {
        resolvePromise({ pid: child.pid!, kill: () => child.kill("SIGKILL") });
      } else if (out.includes("ACQUIRE_FAILED")) {
        rejectPromise(new Error("holder failed to acquire"));
      }
    });
    child.once("error", rejectPromise);
  });
}

describe("adversarial (b): kernel flock semantics with REAL processes", () => {
  it("two-process contention: deterministic timeout at the deadline; kill -9 releases", async () => {
    const dir = makeTempDir("ccsop-flock-");
    const lockPath = join(dir, "contend.lock");
    const holder = await spawnHolder(lockPath);
    try {
      // Starvation: the holder never yields → we fail deterministically at OUR deadline.
      const started = Date.now();
      await expect(acquireFlock(lockPath, acquisitionDeadline(700))).rejects.toThrow(
        LockTimeoutError,
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      // kill -9 the holder: the kernel releases the lock (no steal protocol required).
      holder.kill();
      const handle = await acquireFlock(lockPath, acquisitionDeadline(5_000));
      handle.release();
    } finally {
      holder.kill();
      rmDir(dir);
    }
  });

  it("open-file-description persistence: lock survives the flock child; release() frees it", async () => {
    const dir = makeTempDir("ccsop-flock-");
    const lockPath = join(dir, "ofd.lock");
    try {
      const handle = await acquireFlock(lockPath, acquisitionDeadline(2_000));
      // The flock child has exited by now, yet an external contender must still be blocked.
      const probe = spawnSync("flock", ["-n", lockPath, "-c", "true"]);
      expect(probe.status).not.toBe(0);
      handle.release();
      const probe2 = spawnSync("flock", ["-n", lockPath, "-c", "true"]);
      expect(probe2.status).toBe(0);
    } finally {
      rmDir(dir);
    }
  });

  it("mid-wait cancellation kills the waiting child and rejects LockCancelledError", async () => {
    const dir = makeTempDir("ccsop-flock-");
    const lockPath = join(dir, "cancel.lock");
    const holder = await spawnHolder(lockPath);
    try {
      const ac = new AbortController();
      const attempt = acquireFlock(lockPath, acquisitionDeadline(30_000), ac.signal);
      setTimeout(() => ac.abort(), 150);
      await expect(attempt).rejects.toThrow(LockCancelledError);
    } finally {
      holder.kill();
      rmDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (c) reserve-first lifecycle
// ---------------------------------------------------------------------------------------------

describe("adversarial (c): reserve-first — no per-dispatch effect precedes the durable record", () => {
  it("state-transaction `*.tmp.*` orphans are reaped on recovery", async () => {
    const repo = makeRepo();
    try {
      const store = new ImplementStore(repo.root);
      const dir = resolveControlDir(repo.root, ["implement-state"]);
      const orphan = join(dir, "x.implement.json.tmp.99999.dead");
      writeFileSync(orphan, "{ partial");
      await store.recoverAndGc("adv-d", acquisitionDeadline(10_000));
      expect(existsSync(orphan)).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("during a dispatch the resource root holds ONLY the dispatch's own derived dir; empty after", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      let observed: string[] = [];
      let scratchParentOk = false;
      const d = deps(repo.root, config, async (req) => {
        observed = readdirSync(resourceRoot(repo.root)).filter((n) => !n.startsWith("."));
        scratchParentOk = req.scratchRoot === join(resourceRoot(repo.root), observed[0]!, "scratch");
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\nreserve\n");
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "reserve1"));
      expect(r.ok).toBe(true);
      expect(observed).toHaveLength(1); // exactly the dispatch's own artifact-id dir
      expect(scratchParentOk).toBe(true); // scratch = <resource-root>/<artifact-id>/scratch
      const after = readdirSync(resourceRoot(repo.root)).filter((n) => !n.startsWith("."));
      expect(after).toHaveLength(0); // residue discarded on completion
      // The durable record for the dispatch precedes (and outlives) the resources.
      const state = new ImplementStore(repo.root).read("adv-d")!;
      expect(state.dispatches[0]!.lifecycle).toBe("completed");
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (d) nested .gitattributes are inert bytes (gitless patchgen)
// ---------------------------------------------------------------------------------------------

describe("adversarial (d): nested .gitattributes never transform patch bytes", () => {
  function attributesRepo(): { root: string; cleanup(): void } {
    const repo = makeRepo();
    mkdirSync(join(repo.root, "sub"), { recursive: true });
    writeFileSync(
      join(repo.root, "sub/.gitattributes"),
      "*.txt text eol=lf\n*.bin -text\ndata.txt diff=weird\n",
    );
    writeFileSync(join(repo.root, "sub/data.txt"), "a\r\nb\r\n"); // CRLF content, hostile eol attr
    g(repo.root, ["add", "-A"]);
    g(repo.root, ["commit", "-q", "-m", "attrs"]);
    return repo;
  }

  it("bystander nested attributes: CRLF sibling modification stays byte-exact through apply", async () => {
    const repo = attributesRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["sub/data.txt"]);
      const postimage = "a\r\nchanged\r\nb\r\n";
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "sub/data.txt"), postimage);
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["sub/data.txt"], "attrs1"));
      expect(r.error ?? "").toBe("");
      expect(r.ok).toBe(true);
      // Apply in the caller repo — nested .gitattributes PRESENT — bytes must equal sealed.
      const patch = join(repo.root, r.patch_path!);
      g(repo.root, ["apply", "--check", patch]);
      g(repo.root, ["apply", patch]);
      expect(readFileSync(join(repo.root, "sub/data.txt"), "latin1")).toBe(postimage);
    } finally {
      repo.cleanup();
    }
  });

  it("allowlisted nested .gitattributes itself modifies byte-exactly (inert content)", async () => {
    const repo = attributesRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["sub/.gitattributes"]);
      const postimage = "*.txt text eol=crlf\nnew-rule filter=evil\n";
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "sub/.gitattributes"), postimage);
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["sub/.gitattributes"], "attrs2"));
      expect(r.error ?? "").toBe("");
      expect(r.ok).toBe(true);
      const patch = join(repo.root, r.patch_path!);
      g(repo.root, ["apply", patch]);
      expect(readFileSync(join(repo.root, "sub/.gitattributes"), "latin1")).toBe(postimage);
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (e) topology / kind fidelity
// ---------------------------------------------------------------------------------------------

describe("adversarial (e): opaque-root topology + staged-index gitlink typing", () => {
  const GITLINK_SHA = "0123456789abcdef0123456789abcdef01234567";

  function addGitlink(root: string, path: string): void {
    g(root, ["update-index", "--add", "--cacheinfo", `160000,${GITLINK_SHA},${path}`]);
  }

  it("an unchanged, unrelated tracked symlink is NOT a deletion (the r7 false-violation case)", async () => {
    const repo = makeRepo();
    try {
      symlinkSync("f.txt", join(repo.root, "link.txt"));
      g(repo.root, ["add", "-A"]);
      g(repo.root, ["commit", "-q", "-m", "symlink"]);
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\nsymlink-ok\n");
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "sym-unrelated"));
      expect(r.error ?? "").toBe("");
      expect(r.ok).toBe(true); // v1 falsely violated here; v2 opaque-root absence = unchanged
      expect(r.violations ?? []).toHaveLength(0);
    } finally {
      repo.cleanup();
    }
  });

  it("allowlist naming a symlink directly ⇒ pre-spawn reject (writer never runs)", async () => {
    const repo = makeRepo();
    try {
      symlinkSync("f.txt", join(repo.root, "link.txt"));
      g(repo.root, ["add", "-A"]);
      g(repo.root, ["commit", "-q", "-m", "symlink"]);
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["link.txt"]);
      let writerCalls = 0;
      const d = deps(repo.root, config, async () => {
        writerCalls += 1;
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["link.txt"], "sym-direct"));
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/non-regular path \(symlink\)/);
      expect(writerCalls).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it("gitlink typing from the staged index: initialized AND uninitialized; below-root allowlist rejects; content at the root violates", async () => {
    const repo = makeRepo();
    try {
      addGitlink(repo.root, "subm");
      // "Initialized": worktree directory exists (lstat sees a dir — index must win).
      mkdirSync(join(repo.root, "subm"), { recursive: true });
      writeFileSync(join(repo.root, "subm/inner.txt"), "submodule content\n");
      const config = cfg(repo.root);

      // Allowlist below the gitlink root → pre-spawn reject.
      const cardBelow = makeCard(repo.root, ["subm/inner.txt"]);
      let calls = 0;
      const dBelow = deps(repo.root, config, async () => {
        calls += 1;
        return { text: okText };
      });
      const rBelow = await runImplementFlow(dBelow, input(cardBelow, ["subm/inner.txt"], "gl-below"));
      expect(rBelow.ok).toBe(false);
      expect((rBelow.violations ?? []).join()).toMatch(/below an opaque gitlink root/);
      expect(calls).toBe(0);

      // Unrelated dispatch with the gitlink present (initialized): succeeds — opaque, unchanged.
      const card = makeCard(repo.root, ["f.txt"]);
      const dOk = deps(repo.root, config, async (req) => {
        expect(existsSync(join(req.scratchRoot, "subm"))).toBe(false); // never materialized
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\ngitlink-ok\n");
        return { text: okText };
      });
      const rOk = await runImplementFlow(dOk, input(card, ["f.txt"], "gl-ok"));
      expect(rOk.error ?? "").toBe("");
      expect(rOk.ok).toBe(true);

      // Writer materializes content AT the gitlink path ⇒ violation.
      const dViolate = deps(repo.root, config, async (req) => {
        mkdirSync(join(req.scratchRoot, "subm"), { recursive: true });
        writeFileSync(join(req.scratchRoot, "subm/evil.txt"), "escape\n");
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\ngl-viol\n");
        return { text: okText };
      });
      const rViolate = await runImplementFlow(dViolate, input(card, ["f.txt"], "gl-violate"));
      expect(rViolate.ok).toBe(false);
      expect((rViolate.violations ?? []).join()).toMatch(/opaque root|out-of-allowlist/);

      // Uninitialized: remove the worktree dir — the index still types it (dispatch succeeds).
      rmDir(join(repo.root, "subm"));
      const dUninit = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\ngl-uninit\n");
        return { text: okText };
      });
      const rUninit = await runImplementFlow(dUninit, input(card, ["f.txt"], "gl-uninit"));
      expect(rUninit.error ?? "").toBe("");
      expect(rUninit.ok).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("unmerged (nonzero-stage) index entry ⇒ pre-spawn reject", async () => {
    const repo = makeRepo();
    try {
      const blob = g(repo.root, ["hash-object", "-w", "--stdin"]).trim();
      // hash-object with empty stdin still yields a valid blob id.
      execFileSync("git", ["update-index", "--index-info"], {
        cwd: repo.root,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
        input: `100644 ${blob} 1\tconflict.txt\n100644 ${blob} 2\tconflict.txt\n`,
      });
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      let calls = 0;
      const d = deps(repo.root, config, async () => {
        calls += 1;
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "unmerged"));
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/unmerged index entry/);
      expect(calls).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it("directory preimage at an allowlisted path ⇒ pre-spawn reject (dir opaque root)", async () => {
    const repo = makeRepo();
    try {
      mkdirSync(join(repo.root, "adir"), { recursive: true });
      writeFileSync(join(repo.root, "adir/x.txt"), "x\n");
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["adir"]);
      let calls = 0;
      const d = deps(repo.root, config, async () => {
        calls += 1;
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["adir"], "dir-pre"));
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/non-regular path \(dir\)/);
      expect(calls).toBe(0);
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (f) GC ownership-knowledge completeness
// ---------------------------------------------------------------------------------------------

describe("adversarial (f): unreadable state disables recordless reaping", () => {
  it("corrupt sibling state file ⇒ recordless residue + artifacts are KEPT", async () => {
    const repo = makeRepo();
    try {
      const store = new ImplementStore(repo.root);
      const stateDir = resolveControlDir(repo.root, ["implement-state"]);
      writeFileSync(join(stateDir, "broken.implement.json"), "{ not json");
      const recordlessId = "9".repeat(32);
      mkdirSync(join(resourceRoot(repo.root), recordlessId), { recursive: true });
      const dispatches = resolveControlDir(repo.root, ["dispatches"]);
      writeFileSync(join(dispatches, `${recordlessId}.patch`), "maybe-owned-by-broken-state");
      await store.recoverAndGc("adv-d", acquisitionDeadline(10_000));
      // Ownership knowledge is INCOMPLETE (broken.implement.json unreadable) — nothing
      // recordless may be reaped: an unreadable owner is not a missing owner.
      expect(existsSync(join(resourceRoot(repo.root), recordlessId))).toBe(true);
      expect(existsSync(join(dispatches, `${recordlessId}.patch`))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (bounds / quoting / sig) bounded diff + C-style quoting + cancellation in patchgen
// ---------------------------------------------------------------------------------------------

describe("adversarial (bounds/quoting/sig): gitless diff contract", () => {
  it("pathological all-lines-different beyond the line cap ⇒ deterministic fallback, byte-exact apply", () => {
    const before: string[] = [];
    const after: string[] = [];
    for (let i = 0; i < 60_000; i++) {
      before.push(`old line ${i} ${"x".repeat(10)}`);
      after.push(`new line ${i} ${"y".repeat(10)}`);
    }
    const a = Buffer.from(before.join("\n") + "\n", "utf8");
    const b = Buffer.from(after.join("\n") + "\n", "utf8");
    const started = Date.now();
    const r = generateFilePatch(
      "big.txt",
      { present: true, mode: "100644", bytes: a },
      { present: true, mode: "100644", bytes: b },
    );
    expect(Date.now() - started).toBeLessThan(10_000); // terminates within budget
    expect(r.usedFallback).toBe(true); // whole-file replacement hunk
    expect(r.added).toBe(60_000);
    expect(r.removed).toBe(60_000);
    // Roundtrip through a real git apply.
    const dir = makeTempDir("ccsop-diffb-");
    try {
      g(dir, ["init", "-q"]);
      writeFileSync(join(dir, "big.txt"), a);
      g(dir, ["add", "-A"]);
      g(dir, ["commit", "-q", "-m", "base"]);
      writeFileSync(join(dir, "p.patch"), r.text);
      g(dir, ["apply", "--check", "p.patch"]);
      g(dir, ["apply", "p.patch"]);
      expect(readFileSync(join(dir, "big.txt")).equals(b)).toBe(true);
    } finally {
      rmDir(dir);
    }
  });

  it("exploration-cap exhaustion (interleaved shift) ⇒ fallback still applies byte-exact", () => {
    const before: string[] = [];
    const after: string[] = [];
    for (let i = 0; i < 3_000; i++) {
      before.push(`common`);
      before.push(`only-a-${i}`);
      after.push(`only-b-${i}`);
      after.push(`common`);
    }
    const a = Buffer.from(before.join("\n") + "\n", "utf8");
    const b = Buffer.from(after.join("\n") + "\n", "utf8");
    const r = generateFilePatch(
      "weave.txt",
      { present: true, mode: "100644", bytes: a },
      { present: true, mode: "100644", bytes: b },
      { maxD: 200 },
    );
    expect(r.usedFallback).toBe(true);
    const dir = makeTempDir("ccsop-diffw-");
    try {
      g(dir, ["init", "-q"]);
      writeFileSync(join(dir, "weave.txt"), a);
      g(dir, ["add", "-A"]);
      g(dir, ["commit", "-q", "-m", "base"]);
      writeFileSync(join(dir, "p.patch"), r.text);
      g(dir, ["apply", "p.patch"]);
      expect(readFileSync(join(dir, "weave.txt")).equals(b)).toBe(true);
    } finally {
      rmDir(dir);
    }
  });

  it("C-style quoting matrix: quote/backslash/leading+trailing space/unicode names apply-roundtrip", () => {
    const names = [
      'we"ird.txt',
      "back\\slash.txt",
      " leading.txt",
      "trailing.txt ",
      "文件名.txt",
      'mix "\\ 空 .txt',
      "plain with space.txt", // stays bare (git-compatible)
    ];
    expect(quoteGitPath("a", "plain with space.txt")).toBe("a/plain with space.txt");
    expect(quoteGitPath("a", 'we"ird.txt')).toBe('"a/we\\"ird.txt"');
    expect(quoteGitPath("a", " leading.txt")).toBe('"a/ leading.txt"');
    expect(quoteGitPath("a", "文件名.txt")).toMatch(/^"a\/(\\[0-7]{3})+\.txt"$/);
    const entries = names.map((n, i) => ({
      path: n,
      before: { present: false },
      after: { present: true, mode: "100644" as const, bytes: Buffer.from(`content ${i}\n`) },
    }));
    const built = buildGitPatch(entries);
    const dir = makeTempDir("ccsop-quote-");
    try {
      g(dir, ["init", "-q"]);
      writeFileSync(join(dir, "seed.txt"), "seed\n");
      g(dir, ["add", "-A"]);
      g(dir, ["commit", "-q", "-m", "base"]);
      writeFileSync(join(dir, "p.patch"), built.patch);
      g(dir, ["apply", "p.patch"]);
      for (const [i, n] of names.entries()) {
        expect(readFileSync(join(dir, n), "utf8")).toBe(`content ${i}\n`);
      }
    } finally {
      rmDir(dir);
    }
  });

  it("cancellation inside patch generation aborts via the budget hook", () => {
    const a = Buffer.from(Array.from({ length: 500 }, (_, i) => `a${i}`).join("\n") + "\n");
    const b = Buffer.from(Array.from({ length: 500 }, (_, i) => `b${i}`).join("\n") + "\n");
    let checks = 0;
    expect(() =>
      generateFilePatch(
        "c.txt",
        { present: true, mode: "100644", bytes: a },
        { present: true, mode: "100644", bytes: b },
        {
          checkCancel: () => {
            checks += 1;
            if (checks > 2) throw new Error("cancelled during patch generation");
          },
        },
      ),
    ).toThrow(/cancelled during patch generation/);
  });
});
