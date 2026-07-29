#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseConfigText } from "../dist/config.js";
import { ImplementStore } from "../dist/implement-workspace.js";
import { runClaudeImplementWriter } from "../dist/implement-sandbox.js";
import { handleClaudeImplement } from "../dist/tools/claude-implement.js";

const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const repoRoot = resolve(packageRoot, "../..");
const fixture = mkdtempSync(join(tmpdir(), "ccsop-claude-implement-live-"));

function sha(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function git(args) {
  return execFileSync("git", args, {
    cwd: fixture,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "ccsop-live",
      GIT_AUTHOR_EMAIL: "live@ccsop.invalid",
      GIT_COMMITTER_NAME: "ccsop-live",
      GIT_COMMITTER_EMAIL: "live@ccsop.invalid",
    },
  });
}

try {
  git(["init", "-q"]);
  mkdirSync(join(fixture, ".codex-review"), { recursive: true });
  mkdirSync(join(fixture, "docs/plans/active"), { recursive: true });
  writeFileSync(join(fixture, "hello.txt"), "before\n", "utf8");
  writeFileSync(
    join(fixture, "validation-definition.txt"),
    "operator-owned validation definition\n",
    "utf8",
  );
  const cardPath = "docs/plans/active/claude-implement-live.txt";
  const card = [
    "design_id: ccsop-claude-implement-live",
    "stage: live-smoke",
    "",
    "```files",
    "hello.txt",
    "```",
    "",
  ].join("\n");
  writeFileSync(join(fixture, cardPath), card, "utf8");
  git(["add", "-A"]);
  git(["commit", "-qm", "live baseline"]);

  const template = readFileSync(
    resolve(repoRoot, "templates/config.toml.tpl"),
    "utf8",
  )
    .replaceAll("<PROJECT_ID>", "claude-implement-live")
    .replaceAll("<PROJECT_NAME>", "claude-implement-live")
    .replaceAll("<LANGUAGE>", "en")
    .replaceAll("<REVIEW_PROVIDER>", "codex")
    .replaceAll("<TRANSLATION_PROVIDER>", "none")
    .replace(
      '# design_owner = "claude"',
      'design_owner = "codex"',
    )
    .replace(
      '# implement_owner = "claude"',
      'implement_owner = "claude"',
    )
    .replace(
      "[implement.claude]\nenabled = false",
      "[implement.claude]\nenabled = true",
    )
    .replace("timeout_seconds = 900", "timeout_seconds = 180")
    .replace("max_budget_usd = 5.0", "max_budget_usd = 1.0")
    .replace(
      "max_cumulative_budget_usd = 20.0",
      "max_cumulative_budget_usd = 3.0",
    )
    .replace("max_daily_budget_usd = 50.0", "max_daily_budget_usd = 5.0")
    .replace(
      "validation_commands = []",
      'validation_commands = [["/usr/bin/test", "-f", "hello.txt"]]',
    )
    .replace(
      "validation_definition_paths = []",
      'validation_definition_paths = ["validation-definition.txt"]',
    );
  const configPath = join(fixture, ".codex-review", "config.toml");
  writeFileSync(configPath, template, "utf8");
  const config = parseConfigText(template, configPath).config;
  const deps = {
    config,
    configBaseDir: dirname(configPath),
    writerKind: "claude",
    store: new ImplementStore(fixture),
    runWriterTurn: (request) =>
      runClaudeImplementWriter(config, fixture, request),
  };
  const result = await handleClaudeImplement(deps, {
    design_id: "ccsop-claude-implement-live",
    task_card_path: cardPath,
    task_card_sha256: sha(card),
    files_allowlist: ["hello.txt"],
    work_order:
      'Replace the entire contents of hello.txt with exactly "after from claude" followed by one newline.',
    dispatch_key: "live-1",
  });
  if (!result.ok) {
    throw new Error(`claude_implement failed: ${JSON.stringify(result, null, 2)}`);
  }
  if (readFileSync(join(fixture, "hello.txt"), "utf8") !== "before\n") {
    throw new Error("caller repository changed during proposal generation");
  }
  const patch = readFileSync(join(fixture, result.patch_path), "utf8");
  if (
    !patch.includes("-before") ||
    !patch.includes("+after from claude") ||
    result.writer_kind !== "claude" ||
    result.applicability !== "applicable" ||
    result.apply_policy !== "normal-confirmation"
  ) {
    throw new Error(`unexpected live result: ${JSON.stringify(result, null, 2)}`);
  }
  const report = JSON.parse(
    readFileSync(join(fixture, result.report_path), "utf8"),
  );
  if (
    report.writer_attestation?.backend !== "cli" ||
    report.writer_attestation?.behavioral_probe?.passed !== true ||
    report.writer_attestation?.tools?.join(",") !== "Read,Edit,Write" ||
    report.validation?.status !== "pass"
  ) {
    throw new Error("live attestation is missing CLI/probe/tool facts");
  }
  execFileSync("git", ["apply", "--check", join(fixture, result.patch_path)], {
    cwd: fixture,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        patch_sha256: result.patch_sha256,
        applicability: result.applicability,
        apply_policy: result.apply_policy,
        cli_version: report.writer_attestation.cli_version,
        behavioral_probe: report.writer_attestation.behavioral_probe,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
