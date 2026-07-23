// codex_implement fault-injection / concurrency / session suites (design §8; code r1
// c_acceptance_evidence_overclaims_missing_tests). Complements implement.test.ts.

import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedConfig } from "../src/config.js";
import {
  ImplementStore,
  PROCESS_EPOCH_START_TOKEN,
  computePayloadSha,
  dispatchResourcePaths,
  encodeDesignIdForFilename,
  getDispatch,
  isEpochAlive,
  readProcStartToken,
  resolveControlDir,
  resourceRoot,
  sha256,
} from "../src/implement-workspace.js";
import { acquisitionDeadline } from "../src/locks.js";
import {
  runImplementFlow,
  type ImplementFlowDependencies,
  type WriterTurnRequest,
  type WriterTurnResult,
} from "../src/run-implement-flow.js";
import { parseFilesBlockFromCard } from "../src/allowlist.js";
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
  const root = makeTempDir("ccsop-fi-");
  g(root, ["init", "-q"]);
  writeFileSync(join(root, "f.txt"), "one\ntwo\n");
  g(root, ["add", "-A"]);
  g(root, ["commit", "-q", "-m", "base"]);
  return { root, cleanup: () => rmDir(root) };
}

function makeCard(root: string, files: string[]): string {
  const rel = "docs/plans/active/fi-implement.txt";
  mkdirSync(join(root, "docs/plans/active"), { recursive: true });
  writeFileSync(
    join(root, rel),
    `stage: implement\n\n\`\`\`files\n${files.join("\n")}\n\`\`\`\n`,
  );
  return rel;
}

function cfg(root: string, over: Partial<ResolvedConfig["implement"]> = {}): ResolvedConfig {
  const config = defaultConfig({
    meta: {
      project_id: "fi",
      project_name: "fi",
      language: "en",
      repo_root: root,
      allowed_doc_roots: ["docs/"],
    },
  });
  config.implement = { enabled: true, max_implement_rounds: 5, max_file_bytes: 2097152, ...over };
  return config;
}

type Writer = (req: WriterTurnRequest) => Promise<WriterTurnResult>;

function deps(root: string, config: ResolvedConfig, writer: Writer): ImplementFlowDependencies {
  return { config, configBaseDir: root, store: new ImplementStore(root), runWriterTurn: writer };
}

const okText = 'done {"summary":"ok","files":[],"tests_run":[],"risks":[]}';

function input(card: string, files: string[], key: string, designId = "fi-d") {
  return { designId, taskCardPath: card, filesAllowlist: files, workOrder: "w", dispatchKey: key };
}

describe("fault injection: crash reclaim at every persisted stage", () => {
  it.each(["reserved", "executing"] as const)(
    "dead-epoch %s record → failed(interrupted), round consumed, temp dirs pruned",
    async (stage) => {
      const repo = makeRepo();
      try {
        const config = cfg(repo.root);
        const card = makeCard(repo.root, ["f.txt"]);
        const store = new ImplementStore(repo.root);
        const cardSha = sha256(readFileSync(join(repo.root, card)));
        // v2: records carry NO paths — residue is at DERIVED locations (pure function of the
        // artifact-id under the control root); simulate the crash-left residue there.
        const artifactId = "c".repeat(32);
        const res = dispatchResourcePaths(repo.root, artifactId);
        mkdirSync(res.scratch, { recursive: true });
        mkdirSync(res.home, { recursive: true });
        writeFileSync(join(res.scratch, "leftover.txt"), "crash residue");
        const state = store.newState("fi-d");
        state.dispatches.push({
          dispatch_key: "crashed",
          payload_sha: computePayloadSha({
            workOrder: "w",
            canonicalAllowlist: ["f.txt"],
            cardSha,
            previousFindings: undefined,
          }),
          artifact_id: artifactId,
          round: 2,
          lifecycle: stage,
          epoch_pid: 9_999_999,
          epoch_started_at: "2026-01-01T00:00:00Z",
        });
        state.rounds = 1; // crash happened before the durable round write in an older layout
        store.write(state);

        const d = deps(repo.root, config, async () => ({ text: okText }));
        const r = await runImplementFlow(d, input(card, ["f.txt"], "crashed"));
        expect(r.replayed).toBe(true);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/interrupted/);
        const after = store.read("fi-d")!;
        expect(getDispatch(after, "crashed")!.lifecycle).toBe("failed");
        expect(after.rounds).toBe(2); // reserved round consumed across the crash
        expect(existsSync(res.base)).toBe(false); // derived residue pruned by recovery
      } finally {
        repo.cleanup();
      }
    },
  );

  it("PID REUSE: a stale record on a LIVE unrelated pid with a mismatched epoch token is dead (code r4)", async () => {
    const repo = makeRepo();
    try {
      const store = new ImplementStore(repo.root);
      // The stale record's epoch_pid is process.pid — very much ALIVE — but its epoch_start_token
      // is NOT this process's token (it was created by a since-crashed server that happened to
      // hold this pid). PID-only liveness would wrongly keep it; epoch identity must call it dead.
      const staleId = "1".repeat(32);
      const staleRes = dispatchResourcePaths(repo.root, staleId);
      mkdirSync(staleRes.scratch, { recursive: true });
      // A control record: same live pid, but the REAL current token → genuinely alive, kept.
      const liveId = "2".repeat(32);
      const liveRes = dispatchResourcePaths(repo.root, liveId);
      mkdirSync(liveRes.scratch, { recursive: true });

      const state = store.newState("fi-pidreuse");
      state.dispatches.push({
        dispatch_key: "stale", payload_sha: "x", artifact_id: staleId, round: 1,
        lifecycle: "executing", epoch_pid: process.pid,
        epoch_started_at: "2026-01-01T00:00:00Z", epoch_start_token: "1", // impossible token
      });
      state.dispatches.push({
        dispatch_key: "live", payload_sha: "y", artifact_id: liveId, round: 2,
        lifecycle: "executing", epoch_pid: process.pid,
        epoch_started_at: "2026-01-01T00:00:00Z", epoch_start_token: PROCESS_EPOCH_START_TOKEN!,
      });
      state.rounds = 2;
      store.write(state);
      expect(PROCESS_EPOCH_START_TOKEN).not.toBe("1"); // sanity: real token is a large starttime

      const recovered = (await store.recoverAndGc("fi-pidreuse", acquisitionDeadline(10_000)))!;
      // Stale (pid-reused) → terminalized + residue reaped; genuinely-live → untouched.
      expect(getDispatch(recovered, "stale")!.lifecycle).toBe("failed");
      expect(getDispatch(recovered, "stale")!.failure_reason).toMatch(/interrupted/);
      expect(existsSync(staleRes.base)).toBe(false);
      expect(getDispatch(recovered, "live")!.lifecycle).toBe("executing");
      expect(existsSync(liveRes.base)).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("epoch identity: isEpochAlive is token-aware; readProcStartToken is stable + rejects dead pids", () => {
    expect(readProcStartToken(process.pid)).toBe(PROCESS_EPOCH_START_TOKEN);
    expect(readProcStartToken(process.pid)).toMatch(/^\d+$/);
    expect(readProcStartToken(9_999_999)).toBeNull(); // no such pid
    expect(isEpochAlive(process.pid, PROCESS_EPOCH_START_TOKEN!)).toBe(true);
    expect(isEpochAlive(process.pid, "1")).toBe(false); // pid alive, token mismatch → reused
    expect(isEpochAlive(9_999_999, "1")).toBe(false); // no such pid
    expect(isEpochAlive(process.pid, undefined)).toBe(true); // legacy record → PID-only fallback
  });

  it("published-but-not-completed crash (dead epoch) → failed + its artifacts GC'd; completed-alive kept", async () => {
    const repo = makeRepo();
    try {
      const store = new ImplementStore(repo.root);
      const dispatches = resolveControlDir(repo.root, ["dispatches"]);
      const state = store.newState("fi-d");
      const deadId = "d".repeat(32);
      const liveId = "e".repeat(32);
      writeFileSync(join(dispatches, `${deadId}.patch`), "published-then-crashed");
      writeFileSync(join(dispatches, `${deadId}.report.json`), "{}");
      writeFileSync(join(dispatches, `${liveId}.patch`), "live-completed");
      state.dispatches.push({
        dispatch_key: "dead", payload_sha: "x", artifact_id: deadId, round: 1,
        lifecycle: "executing", epoch_pid: 9_999_999, epoch_started_at: "2026-01-01T00:00:00Z",
      });
      state.dispatches.push({
        dispatch_key: "live", payload_sha: "y", artifact_id: liveId, round: 2,
        lifecycle: "completed", epoch_pid: process.pid, epoch_started_at: "2026-01-01T00:00:00Z",
      });
      // Q20 pin: a completed record whose EPOCH DIED keeps its artifact — the deliverable is
      // never epoch-reaped.
      const deadCompletedId = "f".repeat(32);
      writeFileSync(join(dispatches, `${deadCompletedId}.patch`), "completed-dead-epoch");
      state.dispatches.push({
        dispatch_key: "done-dead", payload_sha: "z", artifact_id: deadCompletedId, round: 3,
        lifecycle: "completed", epoch_pid: 9_999_999, epoch_started_at: "2026-01-01T00:00:00Z",
      });
      state.rounds = 3;
      store.write(state);
      await store.recoverAndGc("fi-d", acquisitionDeadline(10_000));
      // Crash-before-completed resolves failed; its artifacts are inert and collected.
      expect(existsSync(join(dispatches, `${deadId}.patch`))).toBe(false);
      expect(existsSync(join(dispatches, `${deadId}.report.json`))).toBe(false);
      // Completed-owned artifacts are never GC'd — alive OR dead epoch (Q20).
      expect(existsSync(join(dispatches, `${liveId}.patch`))).toBe(true);
      expect(existsSync(join(dispatches, `${deadCompletedId}.patch`))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });
});

describe("cancellation (MCP signal)", () => {
  it("abort during the writer turn → failed, nothing published", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const ac = new AbortController();
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\nthree\n");
        ac.abort(); // cancellation lands while the writer is running
        return { text: okText };
      });
      const r = await runImplementFlow(d, { ...input(card, ["f.txt"], "cancel"), signal: ac.signal });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/cancelled/);
      expect(r.lifecycle).toBe("failed");
      const dispatches = join(repo.root, ".codex-review/dispatches");
      if (existsSync(dispatches)) {
        expect(readdirSync(dispatches).filter((f) => f.endsWith(".patch"))).toHaveLength(0);
      }
    } finally {
      repo.cleanup();
    }
  });

  it("pre-aborted signal → nothing reserved at all", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const ac = new AbortController();
      ac.abort();
      const d = deps(repo.root, config, async () => ({ text: okText }));
      const r = await runImplementFlow(d, { ...input(card, ["f.txt"], "pre"), signal: ac.signal });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/cancelled before start/);
      expect(new ImplementStore(repo.root).read("fi-d")).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});

describe("sealed-capture honesty under a straggler", () => {
  it("a detached writer descendant racing the capture cannot make the patch diverge from sealed facts", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      let straggler: ReturnType<typeof spawn> | null = null;
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\nthree\n");
        // Detached appender keeps mutating the allowlisted file across the capture boundary.
        straggler = spawn(
          "bash",
          ["-c", `setsid bash -c 'for i in $(seq 1 400); do echo x >> "${join(req.scratchRoot, "f.txt")}" 2>/dev/null || exit 0; sleep 0.005; done' &`],
          { detached: true, stdio: "ignore" },
        );
        await new Promise((res) => setTimeout(res, 30)); // let it start racing
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "race"));
      try {
        // Whatever bytes got sealed are the ONLY bytes that exist in facts + patch:
        if (r.ok) {
          const fact = r.files_changed!.find((f) => f.path === "f.txt")!;
          const applyRoot = makeTempDir("ccsop-fi-apply-");
          try {
            execFileSync("cp", ["-a", `${repo.root}/.`, applyRoot]);
            execFileSync("rm", ["-rf", join(applyRoot, ".codex-review")]);
            g(applyRoot, ["apply", "--check", join(repo.root, r.patch_path!)]);
            g(applyRoot, ["apply", join(repo.root, r.patch_path!)]);
            const applied = readFileSync(join(applyRoot, "f.txt"));
            expect(sha256(applied)).toBe(fact.sha_after); // emitted patch == sealed inventory
          } finally {
            rmDir(applyRoot);
          }
        } else {
          // Also honest: the race can trip the scope breaker / size gate — but never publish.
          expect(r.patch_path).toBeUndefined();
        }
      } finally {
        if (straggler) {
          try {
            (straggler as ReturnType<typeof spawn>).kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }
      }
    } finally {
      repo.cleanup();
    }
  });
});

describe("high-byte (invalid UTF-8, NUL-free) patch fidelity", () => {
  it("0x80/0xFF bytes survive generation + apply byte-for-byte", async () => {
    const repo = makeRepo();
    try {
      // Preimage contains invalid-UTF-8 high bytes (NUL-free → text contract accepts).
      const pre = Buffer.from([0x62, 0x80, 0xff, 0x0a, 0x7a, 0x0a]);
      writeFileSync(join(repo.root, "hi.bin.txt"), pre);
      g(repo.root, ["add", "-A"]);
      g(repo.root, ["commit", "-q", "-m", "hi"]);
      const post = Buffer.from([0x63, 0x80, 0xfe, 0x0a, 0x7a, 0x0a]);
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["hi.bin.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "hi.bin.txt"), post);
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["hi.bin.txt"], "hb"));
      expect(r.error ?? "").toBe("");
      expect(r.ok).toBe(true);
      const applyRoot = makeTempDir("ccsop-fi-hb-");
      try {
        execFileSync("cp", ["-a", `${repo.root}/.`, applyRoot]);
        execFileSync("rm", ["-rf", join(applyRoot, ".codex-review")]);
        g(applyRoot, ["apply", join(repo.root, r.patch_path!)]);
        expect(Buffer.compare(readFileSync(join(applyRoot, "hi.bin.txt")), post)).toBe(0);
      } finally {
        rmDir(applyRoot);
      }
    } finally {
      repo.cleanup();
    }
  });
});

describe("writer thread session (design §4.4)", () => {
  it("Q16: FRESH thread per dispatch — no resume requests; per-dispatch thread audit + token totals", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const sawThreadIds: Array<unknown> = [];
      let n = 0;
      const d = deps(repo.root, config, async (req) => {
        sawThreadIds.push((req as Record<string, unknown>)["threadId"]);
        n += 1;
        writeFileSync(join(req.scratchRoot, "f.txt"), `one\ntwo\nr${n}\n`);
        return { text: okText, threadId: `T${n}`, tokensTotal: 100 };
      });
      await runImplementFlow(d, input(card, ["f.txt"], "k1"));
      await runImplementFlow(d, input(card, ["f.txt"], "k2"));
      // The writer boundary NEVER receives a resume id (every dispatch is a fresh thread).
      expect(sawThreadIds).toEqual([undefined, undefined]);
      const state = new ImplementStore(repo.root).read("fi-d")!;
      expect(getDispatch(state, "k1")!.thread_id).toBe("T1"); // audit trail per dispatch
      expect(getDispatch(state, "k2")!.thread_id).toBe("T2");
      expect(state.tokens_used_estimate_total).toBe(200);
    } finally {
      repo.cleanup();
    }
  });

  it("failure + parser streak accounting; breaker note at threshold", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      config.circuit_breakers.codex_failure_streak_threshold = 2;
      const card = makeCard(repo.root, ["f.txt"]);
      let mode: "throw" | "nonjson" | "ok" = "throw";
      let n = 0;
      const d = deps(repo.root, config, async (req) => {
        if (mode === "throw") throw new Error("boom");
        n += 1;
        writeFileSync(join(req.scratchRoot, "f.txt"), `one\ntwo\nn${n}\n`);
        return { text: mode === "nonjson" ? "no json here at all" : okText };
      });
      const f1 = await runImplementFlow(d, input(card, ["f.txt"], "t1"));
      expect(f1.ok).toBe(false);
      expect(f1.session!.codex_failure_streak).toBe(1);
      const f2 = await runImplementFlow(d, input(card, ["f.txt"], "t2"));
      expect(f2.error).toMatch(/codex_unavailable breaker: 2 consecutive/);
      mode = "nonjson";
      const p1 = await runImplementFlow(d, input(card, ["f.txt"], "t3"));
      expect(p1.ok).toBe(true); // a valid patch is not discarded over a bad self-report
      expect(p1.self_report).toBeNull();
      expect(p1.self_report_raw_excerpt).toContain("no json here");
      expect(p1.session!.parser_failure_streak).toBe(1);
      expect(p1.session!.codex_failure_streak).toBe(0); // success reset
    } finally {
      repo.cleanup();
    }
  });

  it("scratch git tampering (writer commits / rewrites config) influences no server fact", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\ntampered-run\n");
        // Adversarial: rewrite scratch git metadata to try to fool validation/facts.
        g(req.scratchRoot, ["add", "-A"]);
        g(req.scratchRoot, ["commit", "-q", "-m", "writer sneaky commit"]);
        g(req.scratchRoot, ["config", "core.autocrlf", "true"]);
        writeFileSync(join(req.scratchRoot, ".git/refs/heads/fake"), "0".repeat(40) + "\n");
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "tamper"));
      expect(r.error ?? "").toBe("");
      expect(r.ok).toBe(true);
      const fact = r.files_changed!.find((f) => f.path === "f.txt")!;
      expect(fact.sha_after).toBe(sha256(Buffer.from("one\ntwo\ntampered-run\n")));
    } finally {
      repo.cleanup();
    }
  });
});

describe("shipped template + result schema pins", () => {
  it("distributed _template-implement.txt placeholders are inert until instantiated", () => {
    // Path is relative to the package root (vitest cwd = mcp/codex-review).
    const tpl = readFileSync(
      "../../templates/docs-scaffold/plans/_template-implement.txt",
      "utf8",
    );
    const raw = parseFilesBlockFromCard(tpl);
    expect(raw.ok).toBe(false); // <path/one.ext> placeholders are rejected by the grammar
    if (!raw.ok) expect(raw.errors.join()).toMatch(/angle bracket/);
    const instantiated = tpl
      .replace("<path/one.ext>", "src/a.ts")
      .replace("<path/two.ext>", "src/b.ts");
    const parsed = parseFilesBlockFromCard(instantiated);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.canonical).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("MCP result schema pin (ok case)", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\npinned\n");
        return { text: okText, threadId: "T1" };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "pin"));
      expect(r.ok).toBe(true);
      expect(Object.keys(r).sort()).toEqual(
        [
          "diffstat", "dispatch_summary", "files_changed", "lifecycle", "ok",
          "patch_path", "report_path", "round", "self_report", "session", "violations",
        ].sort(),
      );
      const fact = r.files_changed![0]!;
      expect(Object.keys(fact).sort()).toEqual(
        ["added", "mode_after", "mode_before", "op", "path", "removed", "sha_after", "sha_before"].sort(),
      );
      expect(r.violations).toEqual([]);
      expect(r.session!.rounds_max).toBe(5);
    } finally {
      repo.cleanup();
    }
  });
});

describe("code r2 hardening suites", () => {
  it("REAL multiprocess lock contention: two child processes never hold the lock concurrently", async () => {
    const dir = makeTempDir("ccsop-lockmp-");
    try {
      const lockPath = join(dir, "x.lock");
      const logPath = join(dir, "log.txt");
      const distUrl = join(process.cwd(), "dist/locks.js");
      // v2: kernel flock via inherited descriptor (Q17). Two real processes contend; the OFD
      // semantics guarantee mutual exclusion and crash-free release.
      const childScript = `
        import { acquireFlock, acquisitionDeadline } from ${JSON.stringify(distUrl)};
        import { appendFileSync } from "node:fs";
        const [lock, log, id] = process.argv.slice(1);
        for (let i = 0; i < 5; i++) {
          const handle = await acquireFlock(lock, acquisitionDeadline(20000));
          appendFileSync(log, "S" + id + "\\n");
          await new Promise((r) => setTimeout(r, 10));
          appendFileSync(log, "E" + id + "\\n");
          handle.release();
        }
      `;
      const run = (id: string) =>
        new Promise<number>((res) => {
          const c = spawn(
            process.execPath,
            ["--input-type=module", "-e", childScript, lockPath, logPath, id],
            { stdio: "inherit" },
          );
          c.on("exit", (code) => res(code ?? 1));
        });
      const [a, b] = await Promise.all([run("A"), run("B")]);
      expect(a).toBe(0);
      expect(b).toBe(0);
      // Mutual exclusion: every S<id> must be immediately followed by E<id>.
      const events = readFileSync(logPath, "utf8").trim().split("\n");
      expect(events).toHaveLength(20);
      for (let i = 0; i < events.length; i += 2) {
        expect(events[i]!.startsWith("S")).toBe(true);
        expect(events[i + 1]!).toBe("E" + events[i]!.slice(1));
      }
    } finally {
      rmDir(dir);
    }
  });

  it("phase exception injection: capture failure terminalizes the record (no stranded executing state)", async () => {
    const repo = makeRepo();
    const moved: string[] = [];
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\nx\n");
        // Root-proof phase sabotage: rename the scratch root away so sealCapture hits ENOENT
        // INSIDE the terminalizing envelope.
        const target = `${req.scratchRoot}-moved`;
        renameSync(req.scratchRoot, target);
        moved.push(target);
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "phase-crash"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/dispatch phase failed/);
      expect(r.lifecycle).toBe("failed");
      const state = new ImplementStore(repo.root).read("fi-d")!;
      expect(getDispatch(state, "phase-crash")!.lifecycle).toBe("failed"); // terminal, replayable
      const replay = await runImplementFlow(d, input(card, ["f.txt"], "phase-crash"));
      expect(replay.replayed).toBe(true);
    } finally {
      for (const m of moved) rmSync(m, { recursive: true, force: true });
      repo.cleanup();
    }
  });

  it("publication failure (control path corrupted mid-flow) terminalizes cleanly", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const d = deps(repo.root, config, async (req) => {
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\npub\n");
        // Corrupt the artifact store path AFTER dispatch start: replace dispatches dir with a file.
        const dir = join(repo.root, ".codex-review/dispatches");
        rmSync(dir, { recursive: true, force: true });
        writeFileSync(dir, "not a directory");
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "pubfail"));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/artifact publication failed|dispatch phase failed/);
      expect(r.lifecycle).toBe("failed");
    } finally {
      repo.cleanup();
    }
  });

  it("residue GC ownership (v2 derived paths): only artifact-id dirs inside the resource root are ever touched", async () => {
    const repo = makeRepo();
    try {
      const store = new ImplementStore(repo.root);
      const outside = makeTempDir("ccsop-outside-marker-");
      const root = resourceRoot(repo.root);
      // v2: DispatchRecord carries NO path fields — path smuggling through state is
      // structurally impossible; GC derives every candidate from artifact ids and never
      // leaves the resource root.
      const oddName = join(root, "not-an-artifact-id");
      mkdirSync(oddName, { recursive: true });
      const recordlessId = "a".repeat(32);
      mkdirSync(join(root, recordlessId), { recursive: true });
      const liveId = "b".repeat(32);
      mkdirSync(join(root, liveId), { recursive: true });
      const state = store.newState("fi-d");
      state.dispatches.push({
        dispatch_key: "live", payload_sha: "x", artifact_id: liveId, round: 1,
        lifecycle: "executing", epoch_pid: process.pid, epoch_started_at: "2026-01-01T00:00:00Z",
      });
      state.rounds = 1;
      store.write(state);
      await store.recoverAndGc("fi-d", acquisitionDeadline(10_000));
      expect(existsSync(outside)).toBe(true); // GC never leaves the resource root
      expect(existsSync(oddName)).toBe(true); // non-artifact-id names are never dispatch dirs
      expect(existsSync(join(root, recordlessId))).toBe(false); // recordless reaped (complete knowledge)
      expect(existsSync(join(root, liveId))).toBe(true); // live nonterminal kept
      rmDir(outside);
    } finally {
      repo.cleanup();
    }
  });

  it("writer git isolation: malicious global config in the writer HOME never executes", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      const sentinel = join(tmpdir(), `ccsop-writer-git-sentinel-${Date.now()}`);
      let statusOut = "x";
      const d = deps(repo.root, config, async (req) => {
        // env.HOME === CODEX_HOME (isolated). Plant a malicious global gitconfig there — the
        // env's GIT_CONFIG_GLOBAL=/dev/null must neutralize it for writer-invoked git.
        expect(req.env.HOME).toBe(req.env.CODEX_HOME);
        expect(req.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
        writeFileSync(
          join(req.env.HOME!, ".gitconfig"),
          `[filter "evil"]\n\tclean = sh -c 'touch ${sentinel}; cat'\n[core]\n\tfsmonitor = true\n`,
        );
        writeFileSync(join(req.scratchRoot, ".gitattributes"), "*.txt filter=evil\n");
        statusOut = execFileSync("git", ["status", "--porcelain"], {
          cwd: req.scratchRoot,
          env: { ...req.env },
        }).toString("utf8");
        writeFileSync(join(req.scratchRoot, "f.txt"), "one\ntwo\niso\n");
        return { text: okText };
      });
      const r = await runImplementFlow(d, input(card, ["f.txt"], "gitiso"));
      // .gitattributes creation is an out-of-allowlist write → violation (also proves Q9).
      expect(r.ok).toBe(false);
      expect((r.violations ?? []).join()).toMatch(/\.gitattributes/);
      expect(statusOut.length).toBeGreaterThan(0); // writer git worked
      expect(existsSync(sentinel)).toBe(false); // and never ran the filter
    } finally {
      repo.cleanup();
    }
  });

  it("design-id filename encoding is injective + read verifies identity", async () => {
    expect(encodeDesignIdForFilename("a/b")).not.toBe(encodeDesignIdForFilename("a_b"));
    expect(encodeDesignIdForFilename("a_x41")).not.toBe(encodeDesignIdForFilename("aA"));
    const repo = makeRepo();
    try {
      const store = new ImplementStore(repo.root);
      const state = store.newState("design-x");
      store.write(state);
      // Hand-copy design-x's state to design-y's encoded filename → read must refuse.
      const dir = resolveControlDir(repo.root, ["implement-state"]);
      const from = join(dir, `${encodeDesignIdForFilename("design-x")}.implement.json`);
      const to = join(dir, `${encodeDesignIdForFilename("design-y")}.implement.json`);
      writeFileSync(to, readFileSync(from));
      expect(() => store.read("design-y")).toThrow(/belongs to design_id/);
    } finally {
      repo.cleanup();
    }
  });

  it("__proto__ / constructor dispatch keys behave as plain records (no prototype pollution)", async () => {
    const repo = makeRepo();
    try {
      const config = cfg(repo.root);
      const card = makeCard(repo.root, ["f.txt"]);
      let n = 0;
      const d = deps(repo.root, config, async (req) => {
        n += 1;
        writeFileSync(join(req.scratchRoot, "f.txt"), `one\ntwo\nproto${n}\n`);
        return { text: okText };
      });
      const r1 = await runImplementFlow(d, input(card, ["f.txt"], "__proto__"));
      expect(r1.error ?? "").toBe("");
      expect(r1.ok).toBe(true);
      const r2 = await runImplementFlow(d, input(card, ["f.txt"], "constructor"));
      expect(r2.ok).toBe(true);
      expect(r2.round).toBe(2); // "constructor" was NOT a phantom existing record
      const replay = await runImplementFlow(d, input(card, ["f.txt"], "__proto__"));
      expect(replay.replayed).toBe(true);
      expect(replay.round).toBe(1);
    } finally {
      repo.cleanup();
    }
  });
});
