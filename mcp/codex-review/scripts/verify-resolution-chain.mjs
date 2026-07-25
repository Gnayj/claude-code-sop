// Runtime half of the §8.2 gate (design ccsop-bridge-deps-lifecycle): prove the codex-binary
// resolution chain drives a REAL review from a clean, dependency-free tree — the zero-install
// headline — and that the no-binary path returns a legible error instead of crashing.
//
// The branching LOGIC (all 4 links, precedence, smoke policy) is covered exhaustively and cheaply
// by tests/codex-resolve.test.ts. This fixture is the expensive, end-to-end complement: it builds
// the actual bundle, strips node_modules, and confirms the shipped code path works. To keep codex
// API cost bounded it runs ONE paid review (link 3, the zero-install proof) plus the link-4 error
// path (no API call). Coverage mapping is printed at the end so nothing is silently skipped.
//
// Usage: node scripts/verify-resolution-chain.mjs <abs-config.toml> [<abs-repo-root>]
//
// NOTE: the runReview() drive loop below hand-rolls the JSON-RPC-over-stdio handshake. The sibling
// scripts/verify-mcp.mjs instead uses @modelcontextprotocol/sdk's Client + StdioClientTransport
// (with stderr:"pipe" for provenance capture and env/cwd for the PATH-scrubbing). A future refactor
// could reuse that; it is left hand-rolled here only to avoid re-spending a paid codex review to
// re-validate a passing gate over a non-shipped script.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const configPath = process.argv[2];
const repoRoot = process.argv[3] ?? path.resolve(pkgRoot, "../..");
if (!configPath) {
  console.error("usage: node scripts/verify-resolution-chain.mjs <abs-config.toml> [<repo-root>]");
  process.exit(2);
}

// 1. Build the bundle from source, then stage a clean tree: bundle + package.json, NO node_modules.
console.log("== building bundle ==");
const b = spawnSync("node", [path.join(here, "bundle.mjs")], { encoding: "utf8" });
if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1); }

const clean = mkdtempSync(path.join(tmpdir(), "ccsop-chain-"));
const cleanDist = path.join(clean, "dist");
spawnSync("mkdir", ["-p", cleanDist]);
copyFileSync(path.join(pkgRoot, "dist/server.js"), path.join(cleanDist, "server.js"));
writeFileSync(path.join(clean, "package.json"), JSON.stringify({ name: "chain-probe", type: "module", private: true }));
console.log(`clean tree: ${clean} (no node_modules)`);

// Drive one MCP design-review call against the clean-tree server; resolve to the tool result.
function runReview(env, { expectError, designId }) {
  return new Promise((resolve) => {
    // Launch via the absolute node path — a codex-free PATH (link-4 test) must not also hide node.
    const srv = spawn(process.execPath, [path.join(cleanDist, "server.js"), "--config", configPath], {
      cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "", buf = "";
    srv.stderr.on("data", (d) => (stderr += d.toString()));
    const send = (o) => srv.stdin.write(JSON.stringify(o) + "\n");
    srv.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
            name: "codex_design_review",
            arguments: {
              design_id: designId,
              force_new_thread: true,
              design_doc_paths: ["docs/methodology/index.md"],
              task_card_path: "docs/methodology/index.md",
              handoff_path: "docs/records/current.md",
              triggers_hit: ["probe: resolution-chain runtime gate"],
            },
          }});
        } else if (msg.id === 2) {
          const txt = msg.result?.content?.[0]?.text ?? "";
          let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }
          srv.kill("SIGTERM");
          resolve({ parsed, stderr, isError: !!msg.result?.isError });
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0" },
    }});
    setTimeout(() => { srv.kill("SIGTERM"); resolve({ parsed: { timeout: true }, stderr, isError: true }); },
      expectError ? 20000 : 280000);
  });
}

const results = {};

// --- link 4: no config path, no package (clean tree), codex NOT on PATH → legible error, no API call.
// PATH must be genuinely codex-free — the node bin dir won't do, codex is often installed beside node.
console.log("\n== link 4 (no binary anywhere) — expect legible error, no crash ==");
{
  const emptyDir = mkdtempSync(path.join(tmpdir(), "ccsop-nopath-"));
  const env = { ...process.env, PATH: emptyDir };
  const { parsed, stderr } = await runReview(env, { expectError: true, designId: "chain-probe-l4" });
  const msg = parsed?.error ?? parsed?.raw ?? "";
  const ok = parsed?.ok === false &&
    /no codex CLI binary found/i.test(msg) &&
    /\[codex\] path/.test(msg) && /@openai\/codex/.test(msg) && /PATH/.test(msg);
  results.link4 = ok;
  console.log(ok ? "PASS — remedy text returned, server did not crash" : "FAIL");
  if (!ok) console.log({ parsed, stderrTail: stderr.slice(-500) });
  rmSync(emptyDir, { recursive: true, force: true });
}

// --- link 3: real PATH codex, no package, no config → zero-install real review.
console.log("\n== link 3 (PATH codex, zero node_modules) — expect REAL review + source=path ==");
{
  const codex = spawnSync("bash", ["-lc", "command -v codex"], { encoding: "utf8" }).stdout.trim();
  if (!codex) { console.log("SKIP — no codex on PATH in this environment"); results.link3 = "skip"; }
  else {
    const { parsed, stderr } = await runReview({ ...process.env }, { expectError: false, designId: "chain-probe-l3" });
    const provOk = /codex binary: source=path/.test(stderr);
    const reviewOk = parsed?.ok === true && !!parsed?.envelope?.verdict;
    results.link3 = provOk && reviewOk;
    console.log(results.link3 ? `PASS — verdict=${parsed.envelope.verdict}, provenance=source=path` : "FAIL");
    if (!results.link3) console.log({ ok: parsed?.ok, provOk, stderrTail: stderr.slice(-400) });
  }
}

rmSync(clean, { recursive: true, force: true });

console.log("\n== coverage map ==");
console.log("  link 1 (config)      : unit (codex-resolve.test.ts) — precedence + warn-and-proceed");
console.log("  link 2 (package)     : unit — used + beats PATH (r3 reversal regression)");
console.log("  link 3 (PATH)        : RUNTIME here + unit");
console.log("  link 4 (none)        : RUNTIME here + unit");
console.log("  smoke / version skew : unit (probe injected)");
console.log("  dynamic-require      : scripts/audit-dynamic-requires.mjs (metafile)");

const hardFail = Object.entries(results).some(([, v]) => v === false);
console.log(`\nresult: ${JSON.stringify(results)}`);
process.exit(hardFail ? 1 : 0);
