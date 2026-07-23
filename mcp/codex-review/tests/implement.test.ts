// codex_implement transaction + identity tests (design ccsop-codex-implement §8).
//
// Real git repos in tmp; the writer is a scripted RunWriterTurn editing the scratch directly.
// Covers: no-caller-write invariant (incl. filter isolation + caller .git byte-identity),
// patch fidelity (CRLF / no-final-newline / delete / exec-bit / unicode names / apply roundtrip),
// violation classes (out-of-allowlist incl. ignored+stray, symlink, both-sides text gate,
// oversize, scope breaker), snapshot domain (absent state, allowlisted-ignored preimage),
// identity (replay / different-payload reject / fresh-key rounds / round cap / interrupted
// reclaim / artifact verification / GC), control-root symlink refusal, scratch git ergonomics.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ResolvedConfig } from "../src/config.js";
import {
  ImplementStore,
  canonicalJson,
  computePayloadSha,
  getDispatch,
  resolveControlDir,
  sha256,
} from "../src/implement-workspace.js";
import {
  runImplementFlow,
  type ImplementFlowDependencies,
  type WriterTurnRequest,
} from "../src/run-implement-flow.js";
import { acquisitionDeadline } from "../src/locks.js";
import { defaultConfig, makeTempDir, rmDir } from "./test-helpers.js";

// ---------- fixture helpers ----------

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

interface CallerRepo {
  root: string;
  cleanup(): void;
}

/** Caller repo with: text files, CRLF file, exec file, tracked-but-ignored file, ignored
 * untracked file, a binary tracked file, dirty modifications, and a dirty tracked deletion. */
function makeCallerRepo(): CallerRepo {
  const root = makeTempDir("ccsop-impl-caller-");
  g(root, ["init", "-q"]);
  writeFileSync(join(root, "src.txt"), "line1\nline2\nline3\n");
  writeFileSync(join(root, "crlf.txt"), "a\r\nb\r\n");
  writeFileSync(join(root, "delete-me.txt"), "bye\n");
  writeFileSync(join(root, "exec.sh"), "#!/bin/sh\necho hi\n");
  chmodSync(join(root, "exec.sh"), 0o755);
  writeFileSync(join(root, "bin.dat"), Buffer.from([1, 0, 2, 0, 3]));
  writeFileSync(join(root, "gone-dirty.txt"), "will be deleted in worktree\n");
  writeFileSync(join(root, "tracked-ignored.txt"), "tracked but matches ignore\n");
  writeFileSync(join(root, ".gitignore"), "ignored-*.txt\ntracked-ignored.txt\n");
  g(root, ["add", "-A"]);
  g(root, ["commit", "-q", "-m", "base"]);
  // Dirty state (the SOP norm): modified tracked file + deleted tracked file + ignored untracked.
  writeFileSync(join(root, "src.txt"), "line1\nline2 DIRTY\nline3\n");
  rmSync(join(root, "gone-dirty.txt"));
  writeFileSync(join(root, "ignored-preimage.txt"), "ignored but allowlisted preimage\n");
  return { root, cleanup: () => rmDir(root) };
}

function makeCard(root: string, files: string[]): string {
  const rel = "docs/plans/active/t-implement.txt";
  mkdirSync(join(root, "docs/plans/active"), { recursive: true });
  writeFileSync(
    join(root, rel),
    `stage: implement\ngoal: test dispatch\n\n\`\`\`files\n${files.join("\n")}\n\`\`\`\n\nforbidden:\n- do not commit\n`,
  );
  return rel;
}

function implConfig(root: string, over: Partial<ResolvedConfig["implement"]> = {}): ResolvedConfig {
  const config = defaultConfig({
    meta: {
      project_id: "impl-test",
      project_name: "impl-test",
      language: "en",
      repo_root: root,
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  config.implement = { enabled: true, max_implement_rounds: 3, max_file_bytes: 2097152, ...over };
  return config;
}

type WriterScript = (scratchRoot: string) => void | Promise<void>;

function makeDeps(
  root: string,
  config: ResolvedConfig,
  script: WriterScript,
): { deps: ImplementFlowDependencies; calls: WriterTurnRequest[]; writerConfigs: string[] } {
  const calls: WriterTurnRequest[] = [];
  const writerConfigs: string[] = [];
  const store = new ImplementStore(root);
  const deps: ImplementFlowDependencies = {
    config,
    configBaseDir: root, // repo_root is absolute → baseDir irrelevant
    store,
    runWriterTurn: async (req) => {
      calls.push(req);
      // Capture the isolated CODEX_HOME config NOW — the env dir is discarded after the flow.
      writerConfigs.push(readFileSync(join(req.env.CODEX_HOME!, "config.toml"), "utf8"));
      await script(req.scratchRoot);
      return {
        text: 'done {"summary":"did the work","files":[],"tests_run":[],"risks":[]}',
      };
    },
  };
  return { deps, calls, writerConfigs };
}

function baseInput(cardRel: string, files: string[], key = "k1", designId = "impl-t") {
  return {
    designId,
    taskCardPath: cardRel,
    filesAllowlist: files,
    workOrder: "do the thing",
    dispatchKey: key,
  };
}

/** Byte-inventory of a tree (skipping the given top-level roots); map path → sha or link target. */
function inventory(root: string, skip: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const name of readdirSync(rel ? join(root, rel) : root)) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (skip.includes(childRel)) continue;
      const st = lstatSync(join(root, childRel));
      if (st.isDirectory()) walk(childRel);
      else if (st.isFile()) out.set(childRel, sha256(readFileSync(join(root, childRel))));
      else out.set(childRel, `link:${st.isSymbolicLink()}`);
    }
  };
  walk("");
  return out;
}

function expectSameInventory(a: Map<string, string>, b: Map<string, string>): void {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  for (const [k, v] of a) expect(`${k}=${b.get(k)}`).toBe(`${k}=${v}`);
}

// ---------- tests ----------

describe("codex_implement flow (proposal mode)", () => {
  it("disabled by default → actionable error; writer never invoked", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root, { enabled: false });
      const card = makeCard(repo.root, ["src.txt"]);
      const { deps, calls } = makeDeps(repo.root, config, () => {});
      const r = await runImplementFlow(deps, baseInput(card, ["src.txt"]));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/disabled/);
      expect(calls).toHaveLength(0);
    } finally {
      repo.cleanup();
    }
  });

  it("happy path from a DIRTY caller: patch fidelity roundtrip (CRLF / delete / exec-bit / unicode / no-final-newline), caller untouched outside .codex-review", async () => {
    const repo = makeCallerRepo();
    try {
      const files = [
        "src.txt", "crlf.txt", "delete-me.txt", "exec.sh",
        "new dir/ünï cøde.txt", "no-newline.txt", "gone-dirty.txt", "ignored-preimage.txt",
      ];
      const config = implConfig(repo.root);
      const card = makeCard(repo.root, files);
      const gitBefore = inventory(join(repo.root, ".git"));
      const treeBefore = inventory(repo.root, [".git", ".codex-review", "docs"]);
      const { deps, calls, writerConfigs } = makeDeps(repo.root, config, (s) => {
        // Modify dirty file ON TOP of its dirty content (snapshot == worktree bytes).
        writeFileSync(join(s, "src.txt"), "line1\nline2 DIRTY\nline3 CHANGED\n");
        writeFileSync(join(s, "crlf.txt"), "a\r\nb\r\nc\r\n"); // CRLF preserved
        rmSync(join(s, "delete-me.txt")); // deletion
        chmodSync(join(s, "exec.sh"), 0o644); // exec-bit flip
        mkdirSync(join(s, "new dir"), { recursive: true });
        writeFileSync(join(s, "new dir/ünï cøde.txt"), "unicode + spaces\n");
        writeFileSync(join(s, "no-newline.txt"), "no trailing newline"); // \ No newline marker
        writeFileSync(join(s, "gone-dirty.txt"), "recreated after dirty deletion\n"); // absent→create
        writeFileSync(join(s, "ignored-preimage.txt"), "ignored but allowlisted preimage\nedited\n");
      });
      const r = await runImplementFlow(deps, baseInput(card, files));
      expect(r.error ?? "").toBe("");
      expect(r.ok).toBe(true);
      expect(calls).toHaveLength(1);
      // Writer env is the isolated CODEX_HOME (capability isolation §4.2.C) with ZERO
      // mcp_servers/plugins tables (attestation) — captured at call time (dir is discarded after).
      expect(calls[0]!.env.CODEX_HOME).toBeTruthy();
      expect(writerConfigs[0]!).not.toMatch(/^\[(mcp_servers|plugins)/m);
      // Caller untouched outside .codex-review; .git byte-identical.
      expectSameInventory(inventory(join(repo.root, ".git")), gitBefore);
      expectSameInventory(inventory(repo.root, [".git", ".codex-review", "docs"]), treeBefore);
      // Artifact exists + report parses.
      const patchAbs = join(repo.root, r.patch_path!);
      expect(existsSync(patchAbs)).toBe(true);
      const report = JSON.parse(readFileSync(join(repo.root, r.report_path!), "utf8"));
      expect(report.files_changed.length).toBe(8);
      expect(r.diffstat!.files).toBe(8);
      const gone = r.files_changed!.find((f) => f.path === "delete-me.txt")!;
      expect(gone.op).toBe("delete");
      expect(gone.sha_after).toBeNull();
      expect(gone.mode_before).toBe("100644");
      expect(report.writer_attestation.mcpServers).toBe(0);
      // Apply roundtrip in a pristine clone of the dirty worktree state.
      const applyRoot = makeTempDir("ccsop-apply-");
      try {
        execFileSync("cp", ["-a", `${repo.root}/.`, applyRoot]);
        rmSync(join(applyRoot, ".codex-review"), { recursive: true, force: true });
        g(applyRoot, ["apply", "--check", patchAbs]);
        g(applyRoot, ["apply", patchAbs]);
        expect(readFileSync(join(applyRoot, "src.txt"), "utf8")).toBe("line1\nline2 DIRTY\nline3 CHANGED\n");
        expect(readFileSync(join(applyRoot, "crlf.txt"), "utf8")).toBe("a\r\nb\r\nc\r\n");
        expect(existsSync(join(applyRoot, "delete-me.txt"))).toBe(false);
        expect(lstatSync(join(applyRoot, "exec.sh")).mode & 0o100).toBe(0);
        expect(readFileSync(join(applyRoot, "new dir/ünï cøde.txt"), "utf8")).toBe("unicode + spaces\n");
        expect(readFileSync(join(applyRoot, "no-newline.txt"), "utf8")).toBe("no trailing newline");
        expect(readFileSync(join(applyRoot, "gone-dirty.txt"), "utf8")).toBe("recreated after dirty deletion\n");
      } finally {
        rmDir(applyRoot);
      }
    } finally {
      repo.cleanup();
    }
  });

  it("filter isolation: malicious clean filter never runs; snapshot equals raw worktree bytes", async () => {
    const repo = makeCallerRepo();
    try {
      const sentinel = join(repo.root, "..", `sentinel-${Date.now()}`);
      writeFileSync(join(repo.root, ".gitattributes"), "*.txt filter=evil\n");
      g(repo.root, ["config", "filter.evil.clean", `sh -c 'touch ${sentinel}; tr a-z A-Z'`]);
      g(repo.root, ["config", "filter.evil.smudge", `sh -c 'touch ${sentinel}; tr A-Z a-z'`]);
      g(repo.root, ["add", ".gitattributes"]);
      g(repo.root, ["commit", "-q", "-m", "attrs"]);
      // The fixture's own git commit above may legitimately run the clean filter (index
      // refresh of stat-dirty paths). What we assert is that the FLOW never does: reset the
      // sentinel here, after all fixture git activity.
      rmSync(sentinel, { force: true });
      const config = implConfig(repo.root);
      const card = makeCard(repo.root, ["src.txt"]);
      let sawRawBytes = "";
      const { deps } = makeDeps(repo.root, config, (s) => {
        sawRawBytes = readFileSync(join(s, "src.txt"), "utf8");
        writeFileSync(join(s, "src.txt"), sawRawBytes + "more\n");
      });
      const r = await runImplementFlow(deps, baseInput(card, ["src.txt"]));
      expect(r.ok).toBe(true);
      // Writer saw the RAW dirty worktree bytes (no clean/smudge transformation).
      expect(sawRawBytes).toBe("line1\nline2 DIRTY\nline3\n");
      expect(existsSync(sentinel)).toBe(false); // no filter process ever spawned
    } finally {
      repo.cleanup();
    }
  });

  it("violations: out-of-allowlist write / ignored stray / symlink result / no changes — no patch, caller untouched", async () => {
    const repo = makeCallerRepo();
    const config = implConfig(repo.root);
    const card = makeCard(repo.root, ["src.txt"]);
    try {
      const cases: Array<[string, WriterScript, RegExp]> = [
        ["out-of-allowlist modify", (s) => writeFileSync(join(s, "crlf.txt"), "x\r\n"), /out-of-allowlist modify: crlf\.txt/],
        ["stray temp file", (s) => writeFileSync(join(s, "notes.tmp"), "scratch"), /out-of-allowlist create: notes\.tmp/],
        ["ignored-path write", (s) => writeFileSync(join(s, "ignored-stray.txt"), "x"), /out-of-allowlist create: ignored-stray\.txt/],
        ["symlink result", (s) => { rmSync(join(s, "src.txt")); symlinkSync("/etc/passwd", join(s, "src.txt")); }, /not a regular file \(symlink\)/],
      ];
      let key = 0;
      for (const [label, script, re] of cases) {
        const { deps } = makeDeps(repo.root, config, script);
        // Per-case design_id: a failed dispatch consumes a round (breaker honesty), so shared
        // ids would exhaust max_implement_rounds across cases.
        const r = await runImplementFlow(
          deps,
          baseInput(card, ["src.txt"], `viol-${key}`, `impl-viol-${key++}`),
        );
        expect(r.ok, label).toBe(false);
        expect((r.violations ?? [r.error]).join("\n"), label).toMatch(re);
        const dispatches = join(repo.root, ".codex-review/dispatches");
        if (existsSync(dispatches)) {
          expect(readdirSync(dispatches).filter((f) => f.endsWith(".patch")), label).toHaveLength(0);
        }
      }
      // Empty delta is a failure too (nothing to propose).
      const { deps } = makeDeps(repo.root, config, () => {});
      const r = await runImplementFlow(deps, baseInput(card, ["src.txt"], "noop", "impl-noop"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no changes/);
    } finally {
      repo.cleanup();
    }
  });

  it("both-sides text gate: binary preimage delete + binary postimage + oversize all reject", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root, { max_file_bytes: 64 });
      const card = makeCard(repo.root, ["bin.dat", "src.txt", "big.txt"]);
      const files = ["bin.dat", "src.txt", "big.txt"];
      // Binary preimage: deleting the tracked binary via the tool is a violation.
      let r = await runImplementFlow(
        makeDeps(repo.root, config, (s) => rmSync(join(s, "bin.dat"))).deps,
        baseInput(card, files, "bin-del"),
      );
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/preimage is binary.*bin\.dat/);
      // Binary postimage.
      r = await runImplementFlow(
        makeDeps(repo.root, config, (s) => writeFileSync(join(s, "src.txt"), Buffer.from([65, 0, 66]))).deps,
        baseInput(card, files, "bin-post"),
      );
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/postimage is binary.*src\.txt/);
      // Oversize postimage (max_file_bytes=64 tightened).
      r = await runImplementFlow(
        makeDeps(repo.root, config, (s) => writeFileSync(join(s, "big.txt"), "x".repeat(100) + "\n")).deps,
        baseInput(card, files, "oversize"),
      );
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/postimage exceeds max_file_bytes=64/);
    } finally {
      repo.cleanup();
    }
  });

  it("scope breaker: oversized line delta discards the dispatch", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root);
      config.circuit_breakers.scope_drift_lines_threshold = 5;
      const card = makeCard(repo.root, ["src.txt"]);
      const { deps } = makeDeps(repo.root, config, (s) =>
        writeFileSync(join(s, "src.txt"), Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n") + "\n"),
      );
      const r = await runImplementFlow(deps, baseInput(card, ["src.txt"]));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/scope breaker/);
    } finally {
      repo.cleanup();
    }
  });

  it("card agreement + grammar: mismatch and control-plane allowlist reject before dispatch", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root);
      const card = makeCard(repo.root, ["src.txt", "crlf.txt"]);
      const { deps, calls } = makeDeps(repo.root, config, () => {});
      let r = await runImplementFlow(deps, baseInput(card, ["src.txt"], "mismatch"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/canonical set mismatch/);
      r = await runImplementFlow(deps, { ...baseInput(card, [".gitignore"], "deny"), filesAllowlist: [".gitignore"] });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/control-plane/);
      expect(calls).toHaveLength(0);
    } finally {
      repo.cleanup();
    }
  });

  it("identity: same-key replay (verified), different-payload reject, fresh-key rounds, round cap", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root, { max_implement_rounds: 2 });
      const card = makeCard(repo.root, ["src.txt"]);
      const { deps, calls } = makeDeps(repo.root, config, (s) =>
        writeFileSync(join(s, "src.txt"), "line1\nline2 DIRTY\nline3\nr1\n"),
      );
      const r1 = await runImplementFlow(deps, baseInput(card, ["src.txt"], "same"));
      expect(r1.ok).toBe(true);
      expect(r1.round).toBe(1);
      // Replay: writer NOT called again; artifacts verified.
      const r1b = await runImplementFlow(deps, baseInput(card, ["src.txt"], "same"));
      expect(r1b.replayed).toBe(true);
      expect(r1b.patch_path).toBe(r1.patch_path);
      expect(calls).toHaveLength(1);
      // Tampered artifact → replay verification fails.
      writeFileSync(join(repo.root, r1.patch_path!), "tampered");
      const r1c = await runImplementFlow(deps, baseInput(card, ["src.txt"], "same"));
      expect(r1c.ok).toBe(false);
      expect(r1c.error).toMatch(/replay verification failed/);
      // Same key, different payload → reject.
      const rDiff = await runImplementFlow(deps, {
        ...baseInput(card, ["src.txt"], "same"),
        workOrder: "different order",
      });
      expect(rDiff.ok).toBe(false);
      expect(rDiff.error).toMatch(/DIFFERENT payload/);
      // Fresh key → round 2; then the cap (max 2) blocks round 3 BEFORE the writer runs.
      const r2 = await runImplementFlow(deps, baseInput(card, ["src.txt"], "fresh2"));
      expect(r2.round).toBe(2);
      const before = calls.length;
      const r3 = await runImplementFlow(deps, baseInput(card, ["src.txt"], "fresh3"));
      expect(r3.ok).toBe(false);
      expect(r3.error).toMatch(/max_implement_rounds/);
      expect(calls.length).toBe(before);
    } finally {
      repo.cleanup();
    }
  });

  it("interrupted reclaim + ownership-aware GC", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root);
      const store = new ImplementStore(repo.root);
      const state = store.newState("impl-t");
      const deadPid = 999_999_9; // outside pid ranges → provably dead
      // The stuck record must carry the REAL payload identity so the later same-key call
      // replays it instead of rejecting as a different payload.
      const cardRelEarly = makeCard(repo.root, ["src.txt"]);
      const cardShaEarly = sha256(readFileSync(join(repo.root, cardRelEarly)));
      state.dispatches.push({
        dispatch_key: "stuck",
        payload_sha: computePayloadSha({
          workOrder: "do the thing",
          canonicalAllowlist: ["src.txt"],
          cardSha: cardShaEarly,
          previousFindings: undefined,
        }),
        artifact_id: "a".repeat(32),
        round: 1,
        lifecycle: "executing",
        epoch_pid: deadPid,
        epoch_started_at: "2026-01-01T00:00:00Z",
      });
      state.rounds = 1;
      store.write(state);
      // Orphan artifacts: one owned by the (soon failed+dead) record, one owned txn temp, one
      // recordless stray (v2 object-class GC scans ALL implement-state files → recordless is
      // meaningful and reapable when ownership knowledge is complete).
      const dispatches = resolveControlDir(repo.root, ["dispatches"]);
      writeFileSync(join(dispatches, `${"a".repeat(32)}.patch`), "orphan");
      writeFileSync(join(dispatches, `${"a".repeat(32)}.patch.tmp.1234.beef`), "owned-temp");
      writeFileSync(join(dispatches, `${"b".repeat(32)}.patch.tmp.9999.dead`), "recordless-stray");
      const recovered = (await store.recoverAndGc("impl-t", acquisitionDeadline(10_000)))!;
      expect(getDispatch(recovered, "stuck")!.lifecycle).toBe("failed");
      expect(getDispatch(recovered, "stuck")!.failure_reason).toMatch(/interrupted/);
      // Object-class GC (Q20): failed-owned artifacts + temps go; recordless goes too (complete
      // ownership knowledge — every state file readable).
      expect(existsSync(join(dispatches, `${"a".repeat(32)}.patch`))).toBe(false);
      expect(existsSync(join(dispatches, `${"a".repeat(32)}.patch.tmp.1234.beef`))).toBe(false);
      expect(existsSync(join(dispatches, `${"b".repeat(32)}.patch.tmp.9999.dead`))).toBe(false);
      // Flow-level: same key now replays the interrupted failure.
      const { deps, calls } = makeDeps(repo.root, config, () => {});
      const r = await runImplementFlow(deps, baseInput(cardRelEarly, ["src.txt"], "stuck"));
      expect(r.replayed).toBe(true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/interrupted/);
      expect(calls).toHaveLength(0);
    } finally {
      repo.cleanup();
    }
  });

  it("control-root symlink substitution → hard abort, nothing written through the link", async () => {
    const repo = makeCallerRepo();
    try {
      const outside = makeTempDir("ccsop-outside-");
      symlinkSync(outside, join(repo.root, ".codex-review"));
      expect(() => resolveControlDir(repo.root, ["dispatches"])).toThrow(/symlink/);
      const config = implConfig(repo.root);
      const card = makeCard(repo.root, ["src.txt"]);
      const { deps, calls } = makeDeps(repo.root, config, (s) =>
        writeFileSync(join(s, "src.txt"), "changed\n"),
      );
      const r = await runImplementFlow(deps, baseInput(card, ["src.txt"], "sym"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/control-state unavailable.*symlink/s);
      // The flow aborts BEFORE any state/lock/artifact write: the symlink target stays
      // byte-for-byte empty (code r1 c_control_state_root_symlink_escape) and the writer
      // was never dispatched.
      expect(readdirSync(outside)).toHaveLength(0);
      expect(calls).toHaveLength(0);
      rmDir(outside);
    } finally {
      repo.cleanup();
    }
  });

  it("scratch git ergonomics: clean status, log -1, diff usable by the writer", async () => {
    const repo = makeCallerRepo();
    try {
      const config = implConfig(repo.root);
      const card = makeCard(repo.root, ["src.txt"]);
      let statusAtStart = "x";
      let logOk = false;
      let diffAfterEdit = "";
      const { deps } = makeDeps(repo.root, config, (s) => {
        statusAtStart = g(s, ["status", "--porcelain"]);
        logOk = g(s, ["log", "-1", "--format=%s"]).includes("baseline");
        writeFileSync(join(s, "src.txt"), "line1\nline2 DIRTY\nline3\nedited\n");
        diffAfterEdit = g(s, ["diff", "--name-only"]);
      });
      const r = await runImplementFlow(deps, baseInput(card, ["src.txt"]));
      expect(r.ok).toBe(true);
      expect(statusAtStart).toBe("");
      expect(logOk).toBe(true);
      expect(diffAfterEdit.trim()).toBe("src.txt");
    } finally {
      repo.cleanup();
    }
  });
});

// ---------- unit: identity encoding ----------

describe("dispatch identity encoding (§4.2.E)", () => {
  it("canonicalJson: reordered objects hash equal; arrays keep order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("payload_sha: field boundaries are framed (no concat ambiguity)", () => {
    const base = { canonicalAllowlist: ["a.ts"], cardSha: "c".repeat(64), previousFindings: null };
    const s1 = computePayloadSha({ ...base, workOrder: "ab" });
    const s2 = computePayloadSha({ ...base, workOrder: "a" });
    const s3 = computePayloadSha({ ...base, workOrder: "ab", canonicalAllowlist: [] as string[] });
    expect(s1).not.toBe(s2);
    expect(s1).not.toBe(s3);
    // Same logical payload → identical sha even with reordered previous_findings keys.
    const p1 = computePayloadSha({ ...base, workOrder: "w", previousFindings: { x: 1, y: 2 } });
    const p2 = computePayloadSha({ ...base, workOrder: "w", previousFindings: { y: 2, x: 1 } });
    expect(p1).toBe(p2);
  });
});
