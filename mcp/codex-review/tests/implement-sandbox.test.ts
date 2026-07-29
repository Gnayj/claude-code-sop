import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildClaudeImplementCliArgs } from "../src/claude-cli-client.js";
import {
  inspectClaudeImplementRuntime,
  validateClaudeProposal,
  versionSatisfiesRange,
} from "../src/implement-sandbox.js";
import {
  BlobStore,
  buildSnapshot,
} from "../src/implement-workspace.js";
import { defaultConfig, makeTempDir, rmDir } from "./test-helpers.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmDir(dirs.pop()!);
});

function claudeConfig() {
  const config = defaultConfig();
  config.meta.control_surface_schema = 2;
  config.collaboration = {
    design_owner: "codex",
    implement_owner: "claude",
  };
  config.implement.claude = {
    enabled: true,
    backend: "cli",
    model: "opus",
    effort: "max",
    cli_path: "",
    timeout_seconds: 30,
    max_output_bytes: 1_048_576,
    max_budget_usd: 5,
    supported_version_range: ">=2.1.220 <2.2.0",
    allow_uncertified_version: false,
    max_dispatches_per_design: 3,
    max_cumulative_wall_seconds: 3600,
    max_cumulative_budget_usd: 20,
    max_daily_budget_usd: 50,
    validation_commands: [],
    validation_definition_paths: [],
    validation_additive_test_globs: [],
    allow_advisory_apply: false,
  };
  return config;
}

describe("Claude implement sandbox contract", () => {
  it("builds the exact no-Bash, no-resume CLI argv", () => {
    const args = buildClaudeImplementCliArgs({
      model: "opus",
      effort: "max",
      systemPrompt: "system",
      maxBudgetUsd: 5,
    });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "opus",
      "--effort",
      "max",
      "--system-prompt",
      "system",
      "--safe-mode",
      "--setting-sources",
      "",
      "--no-session-persistence",
      "--no-chrome",
      "--permission-mode",
      "acceptEdits",
      "--tools",
      "Read,Edit,Write",
      "--max-budget-usd",
      "5",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ]);
    expect(args.join(" ")).not.toMatch(
      /dangerously-skip|bypassPermissions|--bare|Bash|--resume/,
    );
  });

  it("pins the certified semver range", () => {
    expect(versionSatisfiesRange("2.1.220 (Claude Code)", ">=2.1.220 <2.2.0")).toBe(
      true,
    );
    expect(versionSatisfiesRange("2.1.219", ">=2.1.220 <2.2.0")).toBe(false);
    expect(versionSatisfiesRange("2.2.0", ">=2.1.220 <2.2.0")).toBe(false);
    expect(versionSatisfiesRange("not-a-version", ">=2.1.220 <2.2.0")).toBe(
      false,
    );
  });

  it("resolves and attests a secure absolute binary while rejecting relative overrides", () => {
    const root = makeTempDir("ccsop-sandbox-runtime-");
    dirs.push(root);
    const config = claudeConfig();
    const deps = {
      findOnPath: () => "/usr/bin/true",
      spawnProcess: (() => {
        throw new Error("not used");
      }) as never,
      spawnSyncProcess: (() => ({ status: 0 })) as never,
      now: () => 0,
    };
    const runtime = inspectClaudeImplementRuntime(config, root, deps);
    expect(runtime.binaryPath).toBe("/usr/bin/true");
    expect(runtime.bwrapPath).toBe("/usr/bin/true");
    expect(runtime.prlimitPath).toBe("/usr/bin/true");
    expect(runtime.binarySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.bwrapSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.prlimitSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.credentialSha256).toMatch(/^[a-f0-9]{64}$/);

    config.implement.claude.cli_path = "relative/claude";
    expect(() =>
      inspectClaudeImplementRuntime(config, root, deps),
    ).toThrow(/must be absolute/);
  });

  it("classifies definition changes and additive tests without trusting writer tests", async () => {
    const root = makeTempDir("ccsop-validation-classify-");
    dirs.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests/existing.test.ts"), "export {};\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"], {
      cwd: root,
    });
    const blobDir = join(root, ".codex-review", "tmp", "blobs");
    mkdirSync(blobDir, { recursive: true });
    const snapshot = buildSnapshot(
      root,
      ["tests/existing.test.ts", "tests/new.test.ts"],
      new BlobStore(blobDir),
    ).snapshot;
    const config = claudeConfig().implement.claude;
    config.validation_definition_paths = ["tests"];
    config.validation_additive_test_globs = ["tests/**/*.test.ts"];
    const result = await validateClaudeProposal({
      config,
      repoRoot: root,
      snapshot,
      deltas: [
        { path: "tests/existing.test.ts", op: "modify" },
        { path: "tests/new.test.ts", op: "create" },
        { path: "vitest.config.ts", op: "create" },
        { path: "src/config.ts", op: "create" },
      ],
      patch: Buffer.from(""),
      validationRoot: join(root, ".codex-review", "tmp", "validation"),
    });
    expect(result.status).toBe("unconfigured");
    expect(result.applicability).toBe("advisory-only");
    expect(result.validation_affecting_changes).toEqual([
      {
        path: "tests/existing.test.ts",
        classification: "forced-advisory",
      },
      {
        path: "tests/new.test.ts",
        classification: "additive-test-only",
      },
      {
        path: "vitest.config.ts",
        classification: "forced-advisory",
      },
    ]);
    expect(
      result.validation_affecting_changes.some(
        (change) => change.path === "src/config.ts",
      ),
    ).toBe(false);
    expect(result.baseline_only).toBe(true);
    expect(result.apply_policy).toBe("export-only");

    config.allow_advisory_apply = true;
    const optedIn = await validateClaudeProposal({
      config,
      repoRoot: root,
      snapshot,
      deltas: [{ path: "tests/existing.test.ts", op: "modify" }],
      patch: Buffer.from(""),
      validationRoot: join(root, ".codex-review", "tmp", "validation-opt-in"),
    });
    expect(optedIn.applicability).toBe("advisory-only");
    expect(optedIn.apply_policy).toBe("advisory-opt-in");
  });

  it("keeps every shared resolution basename aligned inside and outside definition roots", async () => {
    const root = makeTempDir("ccsop-validation-shared-resolution-");
    dirs.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    const blobDir = join(root, ".codex-review", "tmp", "blobs");
    mkdirSync(blobDir, { recursive: true });
    const snapshot = buildSnapshot(
      root,
      [],
      new BlobStore(blobDir),
    ).snapshot;
    const sharedNames = [
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "deno.json",
      "deno.jsonc",
      "bun.lockb",
      "pyproject.toml",
      "poetry.lock",
      "requirements.txt",
      "requirements-dev.txt",
      "cargo.toml",
      "cargo.lock",
      "go.mod",
      "go.sum",
      "makefile",
      "vite.config.ts",
      "vitest.config.ts",
      "jest.config.js",
      "tsconfig.json",
      "tsconfig.build.json",
    ];
    const config = claudeConfig().implement.claude;
    config.validation_definition_paths = ["defs"];
    config.validation_additive_test_globs = ["defs/**"];
    const result = await validateClaudeProposal({
      config,
      repoRoot: root,
      snapshot,
      deltas: sharedNames.flatMap((name) => [
        { path: name, op: "create" as const },
        { path: `defs/${name}`, op: "create" as const },
      ]),
      patch: Buffer.from(""),
      validationRoot: join(root, ".codex-review", "tmp", "validation-shared"),
    });
    expect(result.validation_affecting_changes).toHaveLength(
      sharedNames.length * 2,
    );
    expect(
      result.validation_affecting_changes.every(
        (change) => change.classification === "forced-advisory",
      ),
    ).toBe(true);
  });

  it("runs configured validation offline and emits applicable only on server PASS", async () => {
    const root = makeTempDir("ccsop-validation-pass-");
    dirs.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, "hello.txt"), "before\n");
    writeFileSync(join(root, "package.json"), '{"private":true}\n');
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-qm",
        "base",
      ],
      { cwd: root },
    );
    const blobDir = join(root, ".codex-review", "tmp", "pass-blobs");
    mkdirSync(blobDir, { recursive: true });
    const snapshot = buildSnapshot(
      root,
      ["hello.txt"],
      new BlobStore(blobDir),
    ).snapshot;
    mkdirSync(join(root, "node_modules"), { recursive: true });
    const config = claudeConfig().implement.claude;
    config.validation_definition_paths = ["package.json"];
    config.validation_commands = [
      ["/usr/bin/test", "-f", "hello.txt"],
      ["/usr/bin/test", "-f", "package.json"],
    ];
    const patch = Buffer.from(
      [
        "diff --git a/hello.txt b/hello.txt",
        "--- a/hello.txt",
        "+++ b/hello.txt",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "",
      ].join("\n"),
    );
    const result = await validateClaudeProposal({
      config,
      repoRoot: root,
      snapshot,
      deltas: [{ path: "hello.txt", op: "modify" }],
      patch,
      validationRoot: join(root, ".codex-review", "tmp", "validation-pass"),
    });
    expect(result.status).toBe("pass");
    expect(result.applicability).toBe("applicable");
    expect(result.apply_policy).toBe("normal-confirmation");
    expect(result.commands).toHaveLength(2);
    expect(result.commands.every((command) => command.exit_code === 0)).toBe(
      true,
    );
    expect(result.dependency_mounts).toEqual(["node_modules"]);
    expect(result.definition_preimage_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
