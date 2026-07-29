import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ImplementLedger } from "../src/implement-ledger.js";
import { ImplementStore } from "../src/implement-workspace.js";
import type {
  ImplementFlowDependencies,
  WriterTurnRequest,
} from "../src/run-implement-flow.js";
import { handleClaudeImplement } from "../src/tools/claude-implement.js";
import { defaultConfig, makeTempDir, rmDir } from "./test-helpers.js";

const roots: string[] = [];

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fixture(): {
  root: string;
  cardPath: string;
  cardSha: string;
  deps: ImplementFlowDependencies;
  calls: WriterTurnRequest[];
} {
  const root = makeTempDir("ccsop-claude-implement-");
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "src.txt"), "before\n");
  mkdirSync(join(root, "secrets"), { recursive: true });
  writeFileSync(join(root, "secrets/.env"), "TOKEN=must-not-leak\n");
  writeFileSync(join(root, "secrets/.env.example"), "TOKEN=public-placeholder\n");
  writeFileSync(join(root, "secrets/id_ed25519"), "must-not-leak\n");
  writeFileSync(join(root, ".netrc"), "machine example.invalid password secret\n");
  mkdirSync(join(root, ".ssh"), { recursive: true });
  writeFileSync(join(root, ".ssh/id_ed25519"), "must-not-leak\n");
  mkdirSync(join(root, "docs/plans/active"), { recursive: true });
  const cardPath = "docs/plans/active/claude-live-implement.txt";
  const card = `design_id: claude-fixture\n\n\`\`\`files\nsrc.txt\n\`\`\`\n`;
  writeFileSync(join(root, cardPath), card);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"],
    { cwd: root },
  );
  const config = defaultConfig();
  config.meta.repo_root = root;
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
    max_budget_usd: 2,
    supported_version_range: ">=2.1.220 <2.2.0",
    allow_uncertified_version: false,
    max_dispatches_per_design: 3,
    max_cumulative_wall_seconds: 120,
    max_cumulative_budget_usd: 6,
    max_daily_budget_usd: 10,
    validation_commands: [],
    validation_definition_paths: [],
    validation_additive_test_globs: [],
    allow_advisory_apply: false,
  };
  const calls: WriterTurnRequest[] = [];
  const deps: ImplementFlowDependencies = {
    config,
    configBaseDir: root,
    writerKind: "claude",
    store: new ImplementStore(root),
    runWriterTurn: async (request) => {
      calls.push(request);
      if (existsSync(join(request.scratchRoot, "secrets/.env"))) {
        throw new Error("tracked secret leaked into Claude scratch");
      }
      if (
        existsSync(join(request.scratchRoot, ".netrc")) ||
        existsSync(join(request.scratchRoot, ".ssh/id_ed25519")) ||
        existsSync(join(request.scratchRoot, "secrets/id_ed25519"))
      ) {
        throw new Error("tracked credential/key leaked into Claude scratch");
      }
      if (!existsSync(join(request.scratchRoot, "secrets/.env.example"))) {
        throw new Error("public .env example was incorrectly filtered");
      }
      writeFileSync(join(request.scratchRoot, "src.txt"), "after\n");
      return {
        text: JSON.stringify({
          summary: "changed src",
          files: ["src.txt"],
          tests_run: [],
          risks: [],
        }),
        threadId: "claude-session",
        tokensTotal: 50,
        wallSeconds: 1.5,
        costUsd: 0.5,
        writerAttestation: {
          backend: "cli",
          tools: ["Read", "Edit", "Write"],
          permission_mode: "acceptEdits",
        },
      };
    },
  };
  return { root, cardPath, cardSha: sha(card), deps, calls };
}

function input(cardPath: string, cardSha: string) {
  return {
    design_id: "claude-fixture",
    task_card_path: cardPath,
    task_card_sha256: cardSha,
    files_allowlist: ["src.txt"],
    work_order: "Change before to after.",
    dispatch_key: "dispatch-1",
  };
}

afterEach(() => {
  while (roots.length > 0) rmDir(roots.pop()!);
});

describe("claude_implement provider adapter", () => {
  it("runs the shared proposal transaction and returns export-only advisory by default", async () => {
    const f = fixture();
    const result = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, f.cardSha),
    );
    expect(result.ok).toBe(true);
    expect(result.writer_kind).toBe("claude");
    expect(result.applicability).toBe("advisory-only");
    expect(result.apply_policy).toBe("export-only");
    expect(result.patch_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.warnings).toContain(
      "operator validation_commands/validation_definition_paths are unconfigured",
    );
    expect(readFileSync(join(f.root, "src.txt"), "utf8")).toBe("before\n");
    expect(
      readFileSync(join(f.root, result.patch_path!), "utf8"),
    ).toContain("+after");
    const report = JSON.parse(
      readFileSync(join(f.root, result.report_path!), "utf8"),
    );
    expect(report.writer_kind).toBe("claude");
    expect(report.writer_attestation.tools).toEqual(["Read", "Edit", "Write"]);
    expect(report.validation.status).toBe("unconfigured");
    expect(new ImplementLedger(f.root).readForTest()!.designs["claude-fixture"].budget_usd).toBe(
      0.5,
    );

    const replay = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, f.cardSha),
    );
    expect(replay.replayed).toBe(true);
    expect(f.calls).toHaveLength(1);
  });

  it("fails exact schema/owner/enabled/card-sha gates before writer spawn", async () => {
    const f = fixture();
    f.deps.config.meta.control_surface_schema = 1;
    let result = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, f.cardSha),
    );
    expect(result.error).toMatch(/control_surface_schema must be 2/);

    f.deps.config.meta.control_surface_schema = 2;
    f.deps.config.collaboration.implement_owner = "codex";
    result = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, f.cardSha),
    );
    expect(result.error).toMatch(/implement_owner must be claude/);

    f.deps.config.collaboration.implement_owner = "claude";
    f.deps.config.implement.claude.enabled = false;
    result = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, f.cardSha),
    );
    expect(result.error).toMatch(/operator opt-in/);

    f.deps.config.implement.claude.enabled = true;
    result = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, "0".repeat(64)),
    );
    expect(result.error).toMatch(/task card sha mismatch/);
    expect(f.calls).toHaveLength(0);
  });

  it("rejects secret paths and cross-writer design buckets", async () => {
    const f = fixture();
    const secretCard = `\`\`\`files\nsecrets/.env.prod\n\`\`\`\n`;
    writeFileSync(join(f.root, f.cardPath), secretCard);
    let result = await handleClaudeImplement(f.deps, {
      ...input(f.cardPath, sha(secretCard)),
      files_allowlist: ["secrets/.env.prod"],
    });
    expect(result.error).toMatch(/hard secret denylist/);

    const keyCard = `\`\`\`files\nsecrets/id_ed25519\n\`\`\`\n`;
    writeFileSync(join(f.root, f.cardPath), keyCard);
    result = await handleClaudeImplement(f.deps, {
      ...input(f.cardPath, sha(keyCard)),
      files_allowlist: ["secrets/id_ed25519"],
      dispatch_key: "secret-key",
    });
    expect(result.error).toMatch(/hard secret denylist/);

    const codexState = f.deps.store.newState("shared-design", "codex");
    f.deps.store.write(codexState);
    writeFileSync(join(f.root, f.cardPath), `\`\`\`files\nsrc.txt\n\`\`\`\n`);
    const bytes = readFileSync(join(f.root, f.cardPath), "utf8");
    result = await handleClaudeImplement(f.deps, {
      ...input(f.cardPath, sha(bytes)),
      design_id: "shared-design",
      dispatch_key: "cross",
    });
    expect(result.error).toMatch(/owned by writer_kind=codex/);
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    "docs/plans/active/claude-live-implement.txt",
    "docs/design/authority-design.md",
    "docs/records/current.md",
  ])("rejects authority path %s before the Claude writer spawns", async (path) => {
    const f = fixture();
    const authorityCard = `\`\`\`files\n${path}\n\`\`\`\n`;
    writeFileSync(join(f.root, f.cardPath), authorityCard);
    const result = await handleClaudeImplement(f.deps, {
      ...input(f.cardPath, sha(authorityCard)),
      files_allowlist: [path],
      dispatch_key: `authority-${path.replaceAll("/", "-")}`,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/authority path is hard-denied/);
    expect(f.calls).toHaveLength(0);
  });

  it("keeps authority denial effective with a non-default plans_active root", async () => {
    const f = fixture();
    f.deps.config.paths.plans_active = "plans/active";
    mkdirSync(join(f.root, "plans/active"), { recursive: true });
    const cardPath = "plans/active/custom-claude-implement.txt";
    const authorityCard = "```files\ndocs/design/authority-design.md\n```\n";
    writeFileSync(join(f.root, cardPath), authorityCard);
    const result = await handleClaudeImplement(f.deps, {
      ...input(cardPath, sha(authorityCard)),
      files_allowlist: ["docs/design/authority-design.md"],
      dispatch_key: "authority-custom-plans-root",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/authority path is hard-denied/);
    expect(f.calls).toHaveLength(0);
  });

  it("quarantines a proposal if caller-repo integrity changes during the writer turn", async () => {
    const f = fixture();
    f.deps.runWriterTurn = async (request) => {
      writeFileSync(join(request.scratchRoot, "src.txt"), "after\n");
      // Simulates an external concurrent actor. A real Claude sandbox cannot see this path.
      writeFileSync(join(f.root, "src.txt"), "concurrent\n");
      return {
        text: '{"summary":"x","files":["src.txt"],"tests_run":[],"risks":[]}',
        wallSeconds: 1,
        costUsd: 0.1,
      };
    };
    const result = await handleClaudeImplement(
      f.deps,
      input(f.cardPath, f.cardSha),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/caller repository integrity changed/);
    expect(result.patch_path).toBeUndefined();
  });
});
