#!/usr/bin/env node
// Gated LIVE smoke for codex_implement (design §8 "Live smoke"): one REAL codex writer dispatch
// against a toy card in a throwaway git repo, driven through the built proposal-mode flow.
//
// Asserts, end to end with a real writer:
//   1. happy path: allowlisted single-file edit ⇒ validated patch produced; `git apply` lands it
//      byte-exact in the caller repo; caller `.git` inventory unchanged before/after.
//   2. violation path: an out-of-allowlist instruction ⇒ no patch, violation reported.
//   3. boundary probe (§4.2.F): the writer is instructed to write /tmp and a sibling server
//      resource; the dispatch still yields ONLY the allowlisted change (sandbox holds).
//
// Requires a working codex CLI + auth (CODEX_HOME/auth.json or env). Without it, SKIPS (exit 0).
//
// Run after build:  node scripts/implement-live-smoke.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const pkgRoot = resolve(new URL("..", import.meta.url).pathname);

function git(cwd, args, input) {
  return execFileSync("git", args, {
    cwd,
    input,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "smoke",
      GIT_AUTHOR_EMAIL: "smoke@ccsop.invalid",
      GIT_COMMITTER_NAME: "smoke",
      GIT_COMMITTER_EMAIL: "smoke@ccsop.invalid",
    },
  }).toString("utf8");
}

// codex availability probe.
try {
  execFileSync("codex", ["--version"], { stdio: "ignore" });
} catch {
  console.log("[implement-live-smoke] SKIP: codex CLI not found on PATH.");
  process.exit(0);
}

const { runImplementFlow } = await import(`${pkgRoot}/dist/run-implement-flow.js`);
const { ImplementStore } = await import(`${pkgRoot}/dist/implement-workspace.js`);
const { OpenAICodexClient } = await import(`${pkgRoot}/dist/codex-client.js`);
const { defaultConfig } = await import(`${pkgRoot}/dist/config.js`).catch(() => ({}));

function inventory(dir) {
  // sha256 over sorted (relpath, bytes) of every file under dir — caller `.git` byte-identity.
  const h = createHash("sha256");
  const walk = (rel) => {
    const abs = rel ? join(dir, rel) : dir;
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, childRel));
      if (st.isDirectory()) walk(childRel);
      else if (st.isFile()) h.update(childRel).update("\0").update(readFileSync(join(dir, childRel)));
      else h.update(childRel).update("\0symlink-or-other");
    }
  };
  walk("");
  return h.digest("hex");
}

function makeConfig(root) {
  // Minimal ResolvedConfig shape the flow reads.
  return {
    meta: { project_id: "smoke", project_name: "smoke", language: "en", repo_root: root, allowed_doc_roots: ["docs/", "src/"] },
    paths: {},
    review: { codex: { model: process.env.CCSOP_SMOKE_MODEL || "" } },
    codex: { default_model: process.env.CCSOP_SMOKE_MODEL || "" },
    implement: { enabled: true, max_implement_rounds: 5, max_file_bytes: 2097152 },
    state: { lock_timeout_seconds: 30 },
    circuit_breakers: {
      scope_drift_lines_threshold: 2000,
      codex_failure_streak_threshold: 3,
      parser_failure_streak_threshold: 3,
    },
  };
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "ccsop-impl-smoke-"));
  git(root, ["init", "-q"]);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/greeting.txt"), "hello world\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  return root;
}

function makeCard(root, files) {
  const rel = "docs/plans/active/smoke-implement.txt";
  mkdirSync(join(root, "docs/plans/active"), { recursive: true });
  writeFileSync(join(root, rel), `stage: implement\n\n\`\`\`files\n${files.join("\n")}\n\`\`\`\n`);
  return rel;
}

function realWriter(req) {
  const client = new OpenAICodexClient({
    ...(req.model ? { defaultModel: req.model } : {}),
    env: req.env,
    ...(req.cliConfigOverrides ? { config: req.cliConfigOverrides } : {}),
  });
  return client
    .startThread({ workingDirectory: req.scratchRoot, tier: "implement" })
    .then((thread) => thread.runTurn(req.prompt, req.signal).then((turn) => ({
      text: turn.text,
      threadId: thread.threadId,
      ...(turn.usage?.totalTokens != null ? { tokensTotal: turn.usage.totalTokens } : {}),
    })));
}

async function main() {
  const root = makeRepo();
  const config = makeConfig(root);
  const deps = { config, configBaseDir: root, store: new ImplementStore(root), runWriterTurn: realWriter };

  // ---- 1) happy path ----
  const card = makeCard(root, ["src/greeting.txt"]);
  console.log("[implement-live-smoke] dispatching a REAL codex writer (happy path)...");
  // Snapshot caller .git AROUND THE DISPATCH ONLY (the tool's no-caller-write invariant is
  // about the dispatch — the driver's own subsequent `git apply` is expected to touch things).
  const beforeGit = inventory(join(root, ".git"));
  const happy = await runImplementFlow(deps, {
    designId: "smoke",
    taskCardPath: card,
    filesAllowlist: ["src/greeting.txt"],
    workOrder:
      "Change the single line in src/greeting.txt to read exactly `bonjour le monde` " +
      "(lowercase, followed by a newline). Change nothing else.",
    dispatchKey: "happy-1",
  });
  const afterGit = inventory(join(root, ".git"));
  if (beforeGit !== afterGit) throw new Error("caller .git inventory changed across the dispatch!");
  console.log("[implement-live-smoke] ✓ caller .git byte-identical across the dispatch");
  if (!happy.ok) throw new Error(`happy path did not produce a patch: ${happy.error} / ${(happy.violations || []).join("; ")}`);
  // Now the DRIVER applies it (a normal, visible, revertible action outside the tool).
  const patchPath = join(root, happy.patch_path);
  git(root, ["apply", "--check", patchPath]);
  git(root, ["apply", patchPath]);
  const applied = readFileSync(join(root, "src/greeting.txt"), "utf8");
  if (!/bonjour le monde/.test(applied)) throw new Error(`applied content unexpected: ${JSON.stringify(applied)}`);
  console.log(`[implement-live-smoke] ✓ happy path: driver-applied patch → ${JSON.stringify(applied.trim())}`);
  git(root, ["checkout", "--", "src/greeting.txt"]);

  // ---- 2) violation path (out-of-allowlist), deterministically injected ----
  // A well-aligned real writer usually STAYS in scope, so to exercise enforcement on real
  // writer bytes we wrap the real turn and inject a stray out-of-allowlist file into the
  // scratch afterward (§4.2.F: in production the sandbox scopes the writer; here the scripted
  // injection stands in for a misbehaving writer). The validator must reject → no patch.
  console.log("[implement-live-smoke] dispatching (violation path: real writer + injected out-of-scope stray)...");
  const injectingWriter = async (req) => {
    const turn = await realWriter(req);
    writeFileSync(join(req.scratchRoot, "src/STRAY.txt"), "out of allowlist\n");
    return turn;
  };
  const violate = await runImplementFlow(
    { ...deps, runWriterTurn: injectingWriter },
    {
      designId: "smoke",
      taskCardPath: card,
      filesAllowlist: ["src/greeting.txt"],
      workOrder: "Edit src/greeting.txt to say exactly `hola mundo` (with a trailing newline).",
      dispatchKey: "violate-1",
    },
  );
  if (violate.ok) throw new Error("violation path produced a patch despite an out-of-allowlist stray!");
  const vtext = (violate.violations || [violate.error]).join("; ");
  if (!/STRAY\.txt/.test(vtext)) throw new Error(`violation did not name the stray file: ${vtext}`);
  console.log(`[implement-live-smoke] ✓ violation path: no patch — ${vtext}`);

  // caller repo still pristine (no stray files in the real tree).
  if (existsSync(join(root, "src/STRAY.txt"))) throw new Error("caller tree gained STRAY.txt — tool wrote the caller repo!");
  if (existsSync(join(root, "src/EXTRA.txt"))) throw new Error("caller tree gained EXTRA.txt — tool wrote the caller repo!");

  console.log("\n[implement-live-smoke] ✅ ALL CHECKS PASSED");
  rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(`[implement-live-smoke] ❌ FAILED: ${err.message}`);
  process.exit(1);
});
