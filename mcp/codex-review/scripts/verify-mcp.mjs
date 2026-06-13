#!/usr/bin/env node
// Verify the codex-review MCP server end-to-end:
//   1) starts via stdio transport
//   2) lists 3 tools (codex_design_review / codex_code_review / codex_fix_review)
//   3) rejects an out-of-allowed_doc_roots tool call (allowed_doc_roots boundary)
//
// Spec source: codex review IM-1 + design §6.1.3 + implement task card §7.1.4

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    writeFileSync(
      cfgPath,
      `
[meta]
project_id = "verify-mcp"
project_name = "verify-mcp"
language = "zh-CN"
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
`.trimStart(),
      "utf8",
    );

    // 2) Spawn server via stdio MCP transport.
    info(`spawning ${serverEntry}`);
    const transport = new StdioClientTransport({
      command: "node",
      args: [serverEntry, "--config", cfgPath],
    });
    const client = new Client(
      { name: "verify-mcp-client", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);

    // 3) List tools.
    info("listing tools");
    const listed = await client.listTools();
    const names = (listed.tools ?? []).map((t) => t.name).sort();
    const expected = ["codex_code_review", "codex_design_review", "codex_fix_review"].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      fail(`tool list mismatch. expected=${expected.join(",")} got=${names.join(",")}`);
    }
    info(`tools listed: ${names.join(", ")}`);

    // 4) allowed_doc_roots reject — task_card_path outside docs/.
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

    await client.close();

    // 5) Degraded start: a NONEXISTENT config must NOT crash the server (the MCP client reports a
    //    crash as "Connection closed"). The server should still connect + list tools, and a tool
    //    call should return a clear, actionable "run /sop-init" error.
    info("degraded start: spawning with a nonexistent config (must connect, not crash)");
    const badCfg = join(tmp, ".codex-review/does-not-exist.toml");
    const dTransport = new StdioClientTransport({
      command: "node",
      args: [serverEntry, "--config", badCfg],
    });
    const dClient = new Client(
      { name: "verify-mcp-degraded", version: "0.1.0" },
      { capabilities: {} },
    );
    await dClient.connect(dTransport); // throws if the server crashed → would be "Connection closed"
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
    info("degraded start confirmed: connected + listed 3 tools + actionable error (no crash)");

    info("RESULT: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  fail(`uncaught: ${err.message}\n${err.stack ?? ""}`);
});
