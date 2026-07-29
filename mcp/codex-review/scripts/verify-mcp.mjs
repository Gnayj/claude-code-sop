#!/usr/bin/env node
// Verify the codex-review MCP server end-to-end:
//   1) starts via stdio transport
//   2) lists the review, Codex/Claude implement, and configure tools
//   3) verifies contract v2 migration and per-invocation config reload
//   4) rejects an out-of-allowed_doc_roots tool call (allowed_doc_roots boundary)
//
// Spec source: codex review IM-1 + design §6.1.3 + implement task card §7.1.4
// This intentionally uses dependency-free JSON-RPC framing so the bundled/clean-tree smoke remains
// runnable where node_modules (and therefore the MCP SDK client transport) is unavailable.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

// Package root = one level up from scripts/ (i.e. mcp/codex-review/).
const pkgRoot = resolve(new URL("..", import.meta.url).pathname);
const serverEntry = resolve(pkgRoot, "dist/server.js");

function fail(msg) {
  console.error(`[verify-mcp] FAIL: ${msg}`);
  process.exit(1);
}
function info(msg) {
  console.log(`[verify-mcp] ${msg}`);
}

async function connectServer(configPath) {
  const child = spawn(process.execPath, [serverEntry, "--config", configPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        for (const waiter of pending.values()) {
          waiter.reject(new Error(`invalid server JSON: ${err.message}: ${line.slice(0, 200)}`));
        }
        pending.clear();
        continue;
      }
      if (message.id === undefined) continue;
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) {
        waiter.reject(new Error(`MCP ${message.error.code}: ${message.error.message}`));
      } else {
        waiter.resolve(message.result);
      }
    }
  });
  child.on("exit", (code, signal) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`server exited code=${code} signal=${signal}`));
    }
    pending.clear();
  });

  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`timeout waiting for ${method}`));
      }, 10_000);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      send({ jsonrpc: "2.0", id, method, params });
    });

  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-mcp-client", version: "0.1.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    listTools: async () => request("tools/list"),
    callTool: async ({ name, arguments: args }) =>
      request("tools/call", { name, arguments: args }),
    close: async () => {
      child.stdin.end();
      child.kill("SIGTERM");
      await new Promise((resolveClose) => child.once("exit", resolveClose));
    },
  };
}

async function main() {
  // 1) Build a self-contained tmp project with strict allowed_doc_roots.
  const tmp = mkdtempSync(join(tmpdir(), "codex-review-mcp-verify-"));
  try {
    mkdirSync(join(tmp, ".codex-review/sessions"), { recursive: true });
    mkdirSync(join(tmp, ".codex-review/archive"), { recursive: true });
    mkdirSync(join(tmp, ".codex-review/templates"), { recursive: true });
    mkdirSync(join(tmp, "docs"), { recursive: true });

    const tplDir = resolve(pkgRoot, "templates");
    for (const name of ["design-review", "code-review", "fix-review", "summary"]) {
      const src = `${tplDir}/${name}.md.tpl`;
      writeFileSync(
        join(tmp, `.codex-review/templates/${name}.md.tpl`),
        readFileSync(src, "utf8"),
        "utf8",
      );
    }
    writeFileSync(join(tmp, "docs/d.md"), "design content", "utf8");
    writeFileSync(join(tmp, "docs/task.md"), "task card", "utf8");
    writeFileSync(join(tmp, "docs/handoff.md"), "handoff", "utf8");

    const cfgPath = join(tmp, ".codex-review/config.toml");
    const configText = `
[meta]
project_id = "verify-mcp"
project_name = "verify-mcp"
language = "zh-CN"
control_surface_schema = 1
repo_root = ".."
allowed_doc_roots = ["docs/", ".codex-review/templates/"]

[paths]
sop = "docs/sop.md"
collaboration_sop = "docs/collab.md"
handoff = "docs/handoff.md"
plans_active = "docs/plans/active"
plans_completed = "docs/plans/completed"
sessions_dir = ".codex-review/sessions"
backlog_dir = ".codex-review/backlog"
archive_dir = ".codex-review/archive"

[review.design]
prompt_template = ".codex-review/templates/design-review.md.tpl"
verdict_enum = ["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]

[review.code]
prompt_template = ".codex-review/templates/code-review.md.tpl"
verdict_enum = ["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]

[review.fix]
prompt_template = ".codex-review/templates/fix-review.md.tpl"
verdict_enum = ["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]

[circuit_breakers]
design_mechanical_max_sections = 8
code_mechanical_max_fix_lines = 100
code_mechanical_max_modules = 1

[safety]
extra_danger_verbs_regex = ""

[codex]
default_model = ""
`.trimStart();
    writeFileSync(cfgPath, configText, "utf8");

    // 2) Spawn server via stdio MCP transport.
    info(`spawning ${serverEntry}`);
    const client = await connectServer(cfgPath);

    // 3) List tools.
    info("listing tools");
    const listed = await client.listTools();
    const names = (listed.tools ?? []).map((t) => t.name).sort();
    const expected = [
      "ccsop_configure",
      "codex_code_review",
      "codex_design_review",
      "codex_fix_review",
      "codex_implement",
      "claude_implement",
    ].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      fail(`tool list mismatch. expected=${expected.join(",")} got=${names.join(",")}`);
    }
    info(`tools listed: ${names.join(", ")}`);

    // 4) Contract-v2 bridge over a schema-1 consumer, then server-fixed migration.
    info("calling ccsop_configure status");
    const statusCall = await client.callTool({
      name: "ccsop_configure",
      arguments: { action: "status" },
    });
    const statusText = (statusCall.content ?? []).map((c) => c.text ?? "").join("\n");
    const status = JSON.parse(statusText);
    if (
      statusCall.isError === true ||
      status.contract_version !== 2 ||
      status.observed_schema !== 1
    ) {
      fail(`configure status handshake failed: ${statusText.slice(0, 400)}`);
    }
    info("configure schema=1 / contract=2 bridge handshake confirmed");
    const migrateCall = await client.callTool({
      name: "ccsop_configure",
      arguments: {
        action: "migrate-schema-v2",
        expected_config_sha256: status.after_sha256,
      },
    });
    const migrateText = (migrateCall.content ?? []).map((c) => c.text ?? "").join("\n");
    const migrated = JSON.parse(migrateText);
    const migratedBytes = readFileSync(cfgPath, "utf8");
    if (
      migrateCall.isError === true ||
      migrated.observed_schema !== 2 ||
      !migratedBytes.includes("[implement.claude]") ||
      !migratedBytes.includes("enabled = false")
    ) {
      fail(`configure schema-2 migration failed: ${migrateText.slice(0, 400)}`);
    }
    info("server-fixed schema=1→2 migration and disabled Claude section confirmed");

    // 5) allowed_doc_roots reject — task_card_path outside docs/.
    info("calling codex_design_review with out-of-root path (must be rejected)");
    const callResult = await client.callTool({
      name: "codex_design_review",
      arguments: {
        design_id: "verify-mcp-d1",
        design_doc_paths: ["docs/d.md"],
        task_card_path: "/etc/passwd",
        handoff_path: "docs/handoff.md",
        triggers_hit: ["4.5.10"],
      },
    });
    const text = (callResult.content ?? []).map((c) => c.text ?? "").join("\n");
    const isErrorPath =
      callResult.isError === true ||
      /AllowedDocRootViolation|outside allowed_doc_roots/.test(text);
    if (!isErrorPath) {
      fail(`expected reject for /etc/passwd, but got ok response: ${text.slice(0, 400)}`);
    }
    info("out-of-root reject confirmed");

    // 6) Every non-config public invocation must rebuild from current disk bytes. Make the config
    // invalid after startup; the next call must fail at reload before dispatching to a provider.
    info("runtime reload: injecting invalid effort after startup");
    writeFileSync(
      cfgPath,
      `${configText}\n[review.codex]\neffort = "invalid-live-reload"\n`,
      "utf8",
    );
    const reloadCall = await client.callTool({
      name: "codex_design_review",
      arguments: {
        design_id: "verify-mcp-reload",
        design_doc_paths: ["docs/d.md"],
        task_card_path: "docs/task.md",
        handoff_path: "docs/handoff.md",
        triggers_hit: ["4.5.10"],
      },
    });
    const reloadText = (reloadCall.content ?? []).map((c) => c.text ?? "").join("\n");
    if (
      reloadCall.isError !== true ||
      !/config load failed|invalid-live-reload/i.test(reloadText)
    ) {
      fail(`next invocation did not observe changed config: ${reloadText.slice(0, 400)}`);
    }
    writeFileSync(cfgPath, configText, "utf8");
    info("per-invocation config reload confirmed");

    await client.close();

    // 7) Degraded start: a NONEXISTENT config must NOT crash the server (the MCP client reports a
    //    crash as "Connection closed"). The server should still connect + list tools, and a tool
    //    call should return a clear, actionable "run /sop-init" error.
    info("degraded start: spawning with a nonexistent config (must connect, not crash)");
    const badCfg = join(tmp, ".codex-review/does-not-exist.toml");
    const dClient = await connectServer(badCfg);
    const dNames = ((await dClient.listTools()).tools ?? []).map((t) => t.name).sort();
    if (JSON.stringify(dNames) !== JSON.stringify(expected)) {
      fail(`degraded tool list mismatch. got=${dNames.join(",")}`);
    }
    const dCall = await dClient.callTool({
      name: "codex_code_review",
      arguments: {
        design_id: "x",
        task_card_path: "docs/d.md",
        design_doc_paths: ["docs/d.md"],
        handoff_path: "docs/handoff.md",
        diff_spec: "x",
        changed_files: ["x"],
        claude_output: {},
        tests_run: ["x"],
        validation_evidence: "x",
        docs_updated: [],
      },
    });
    const dText = (dCall.content ?? []).map((c) => c.text ?? "").join("\n");
    if (!(dCall.isError === true && /config not found|\/sop-init/i.test(dText))) {
      fail(`degraded call expected a 'run /sop-init' error, got: ${dText.slice(0, 300)}`);
    }
    await dClient.close();
    info("degraded start confirmed: connected + listed tools + actionable error (no crash)");

    info("RESULT: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  fail(`uncaught: ${err.message}\n${err.stack ?? ""}`);
});
