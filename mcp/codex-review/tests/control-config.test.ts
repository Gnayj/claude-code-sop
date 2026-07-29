import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeConfigStore } from "../src/runtime-config-store.js";
import { CONTROL_SURFACE_CONTRACT_V1 } from "../src/control-surface-contract.js";
import {
  applyTomlUpdates,
  writeConfigAtomically,
  type ConfigWriteFaultPoint,
} from "../src/config-writer.js";
import { handleCcsopConfigure } from "../src/tools/ccsop-configure.js";
import { makeTempDir, rmDir } from "./test-helpers.js";

const dirs: string[] = [];

function configText(schema?: number): string {
  return `[meta]
project_id = "fixture"
project_name = "fixture"
language = "en"
repo_root = ".."
allowed_doc_roots = ["docs/"]
${schema === undefined ? "" : `control_surface_schema = ${schema}\n`}
[paths]
sop = "docs/sop.md"
collaboration_sop = "docs/collab.md"
handoff = "docs/current.md"
plans_active = "docs/plans/active"
plans_completed = "docs/plans/completed"
sessions_dir = ".codex-review/sessions"
backlog_dir = ".codex-review/backlog"
archive_dir = ".codex-review/archive"

[collaboration]
autonomy = "gated"
# consumer comment survives

[review]
provider = "codex"
max_injected_diff_bytes = 262144

[review.design]
prompt_template = ".codex-review/templates/design.md"
verdict_enum = ["Go", "No-Go"]

[review.code]
prompt_template = ".codex-review/templates/code.md"
verdict_enum = ["Pass", "No-Go"]

[review.fix]
prompt_template = ".codex-review/templates/fix.md"
verdict_enum = ["All-fixed", "No-Go"]

[review.codex]
model = ""
effort = ""

[review.claude]
backend = "api"
model = ""
effort = ""
cli_path = ""
max_tokens = 16000
key_env = "ANTHROPIC_API_KEY"
context_window = 200000

[review.manual]
sessions_dir = ""

[codex]
default_model = ""
default_effort = ""
path = ""

[implement]
enabled = false
model = ""
effort = ""
max_implement_rounds = 3
max_file_bytes = 2097152

[state]
lock_timeout_seconds = 30
session_retention_days = 90
backlog_retention_days = 180

[circuit_breakers]
max_design_review_rounds = 3
max_code_review_rounds = 3
max_fix_review_rounds = 3
scope_drift_lines_threshold = 400
context_warn_pct = 0.6
context_force_new_thread_pct = 0.8
codex_failure_streak_threshold = 3
parser_failure_streak_threshold = 3
design_mechanical_max_sections = 8
code_mechanical_max_fix_lines = 100
code_mechanical_max_modules = 1

[safety]
extra_danger_verbs_regex = ""

[consumer]
unknown_key = "preserve-me"
`;
}

function fixture(schema?: number): { dir: string; path: string } {
  const dir = makeTempDir("ccsop-control-config-");
  dirs.push(dir);
  const controlDir = join(dir, ".codex-review");
  const path = join(controlDir, "config.toml");
  // makeTempDir exists; RuntimeConfigStore/config writer create the nested control dir only for
  // backups, while this fixture authors the input file explicitly.
  mkdirSync(controlDir, { recursive: true });
  writeFileSync(path, configText(schema), "utf8");
  return { dir, path };
}

afterEach(() => {
  while (dirs.length > 0) rmDir(dirs.pop()!);
});

describe("ccsop_configure Phase 1 contract", () => {
  it("stamps an absent schema atomically and preserves every unrelated byte", () => {
    const { path } = fixture();
    const store = new RuntimeConfigStore(path);
    const before = store.inspect();

    const result = handleCcsopConfigure(path, {
      action: "stamp-schema-v1",
      expected_config_sha256: before.sha256,
    });

    expect(result.ok).toBe(true);
    expect(result.contract_version).toBe(1);
    expect(result.changed_keys).toEqual(["meta.control_surface_schema"]);
    expect(result.before_sha256).toBe(before.sha256);
    expect(result.after_sha256).not.toBe(before.sha256);
    const after = readFileSync(path, "utf8");
    expect(after).toContain("control_surface_schema = 1");
    expect(after).toContain("# consumer comment survives");
    expect(after).toContain('unknown_key = "preserve-me"');
    expect(result.backup_path).toBeTruthy();
    expect(readFileSync(result.backup_path!, "utf8")).toBe(before.text);
  });

  it("makes schema=1 stamping idempotent and rejects unknown schemas with zero writes", () => {
    const one = fixture(1);
    const oneStore = new RuntimeConfigStore(one.path);
    const beforeOne = oneStore.inspect();
    const noOp = handleCcsopConfigure(one.path, {
      action: "stamp-schema-v1",
      expected_config_sha256: beforeOne.sha256,
    });
    expect(noOp.ok).toBe(true);
    expect(noOp.changed_keys).toEqual([]);
    expect(readFileSync(one.path, "utf8")).toBe(beforeOne.text);

    const unknown = fixture(9);
    const unknownStore = new RuntimeConfigStore(unknown.path);
    const beforeUnknown = unknownStore.inspect();
    expect(() =>
      handleCcsopConfigure(unknown.path, {
        action: "stamp-schema-v1",
        expected_config_sha256: beforeUnknown.sha256,
      }),
    ).toThrow(/unsupported control_surface_schema=9/);
    expect(readFileSync(unknown.path, "utf8")).toBe(beforeUnknown.text);
  });

  it("sets codex flows without creating any Claude implement surface", () => {
    const { path } = fixture(1);
    const store = new RuntimeConfigStore(path);
    const first = handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: store.inspect().sha256,
      flow: "codex+claude",
    });
    expect(first.ok).toBe(true);
    expect(first.delivery).toBe("manual relay");
    let text = readFileSync(path, "utf8");
    expect(text).toContain('design_owner = "codex"');
    expect(text).toContain('implement_owner = "claude"');
    expect(text).not.toContain("[implement.claude]");
    expect(text).toContain("enabled = false");

    const second = handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      flow: "codex+codex",
    });
    expect(second.ok).toBe(true);
    text = readFileSync(path, "utf8");
    expect(text).toContain('implement_owner = "codex"');
    expect(text).not.toContain("[implement.claude]");
  });

  it("preserves the published Claude flow coupling through the same writer", () => {
    const { path } = fixture(1);
    const first = handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      flow: "claude+codex",
    });
    expect(first.changed_keys).toEqual([
      "collaboration.design_owner",
      "collaboration.implement_owner",
      "implement.enabled",
    ]);
    expect(readFileSync(path, "utf8")).toContain("enabled = true");

    handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      flow: "claude+claude",
    });
    expect(readFileSync(path, "utf8")).toContain("enabled = false");
  });

  it("round-trips every consumed tier and enforces provider-specific fields", () => {
    const { path } = fixture(1);
    const claude = handleCcsopConfigure(path, {
      action: "set-tier",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      scope: "claude-review",
      model: "claude-opus-5",
      effort: "max",
      backend: "cli",
    });
    expect(claude.changed_keys).toEqual([
      "review.claude.backend",
      "review.claude.model",
      "review.claude.effort",
    ]);

    const codexReview = handleCcsopConfigure(path, {
      action: "set-tier",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      scope: "codex-review",
      model: "gpt-5.4",
      effort: "xhigh",
    });
    expect(codexReview.changed_keys).toEqual([
      "review.codex.model",
      "review.codex.effort",
    ]);

    const dispatch = handleCcsopConfigure(path, {
      action: "set-tier",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      scope: "codex-dispatch",
      model: "gpt-5.3-codex",
      effort: "high",
    });
    expect(dispatch.changed_keys).toEqual([
      "implement.model",
      "implement.effort",
    ]);

    const defaults = handleCcsopConfigure(path, {
      action: "set-tier",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      scope: "codex-default",
      model: "gpt-5.2",
      effort: "medium",
    });
    expect(defaults.changed_keys).toEqual([
      "codex.default_model",
      "codex.default_effort",
    ]);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('[review.claude]\nbackend = "cli"\nmodel = "claude-opus-5"\neffort = "max"');
    expect(text).toContain('[review.codex]\nmodel = "gpt-5.4"\neffort = "xhigh"');
    expect(text).toContain('[codex]\ndefault_model = "gpt-5.2"\ndefault_effort = "medium"');
    expect(text).toContain('[implement]\nenabled = false\nmodel = "gpt-5.3-codex"\neffort = "high"');

    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-tier",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        scope: "codex-review",
        effort: "max",
      }),
    ).toThrow(/invalid codex effort/);
    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-tier",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        scope: "codex-review",
        backend: "cli",
      }),
    ).toThrow(/backend is not accepted/);
    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-tier",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        scope: "codex-default",
      }),
    ).toThrow(/requires at least one/);
    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-tier",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        scope: "claude-implement",
        effort: "max",
      }),
    ).toThrow(/unsupported Phase 1 tier scope/);
  });

  it("fails compare-and-swap races without writing", () => {
    const { path } = fixture(1);
    const before = readFileSync(path, "utf8");
    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-flow",
        expected_config_sha256: "0".repeat(64),
        flow: "codex+codex",
      }),
    ).toThrow(/config sha mismatch/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("reports Zod-invalid config read-only and repairs invalid target keys", () => {
    const { path } = fixture(1);
    const invalid = readFileSync(path, "utf8").replace(
      '[collaboration]\nautonomy = "gated"',
      '[collaboration]\ndesign_owner = "gemini"\nimplement_owner = "gemini"\nautonomy = "gated"',
    );
    writeFileSync(path, invalid, "utf8");

    const status = handleCcsopConfigure(path, { action: "status" });
    expect(status.status).toMatchObject({
      config_valid: false,
      flow_mode: "invalid",
      design_owner: "gemini",
      implement_owner: "gemini",
    });
    expect(status.status?.validation_error).toContain("Invalid enum value");
    expect(readFileSync(path, "utf8")).toBe(invalid);

    const repaired = handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: status.before_sha256,
      flow: "codex+codex",
    });
    expect(repaired.changed_keys).toEqual([
      "collaboration.design_owner",
      "collaboration.implement_owner",
    ]);
    expect(new RuntimeConfigStore(path).loadValidated().config.collaboration).toMatchObject({
      design_owner: "codex",
      implement_owner: "codex",
    });
  });

  it("fully validates a candidate before publish and leaves invalid bytes untouched", () => {
    const { path } = fixture(1);
    const invalid = readFileSync(path, "utf8").replace(
      '[review.codex]\nmodel = ""\neffort = ""',
      '[review.codex]\nmodel = ""\neffort = "impossible"',
    );
    writeFileSync(path, invalid, "utf8");
    const before = new RuntimeConfigStore(path).inspect();

    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-flow",
        expected_config_sha256: before.sha256,
        flow: "codex+codex",
      }),
    ).toThrow(/candidate config failed validation before publish/);
    expect(readFileSync(path, "utf8")).toBe(invalid);
    expect(existsSync(join(join(path, ".."), ".config.toml.ccsop.lock"))).toBe(false);
  });

  it("rejects fields that do not belong to the selected action", () => {
    const { path } = fixture(1);
    const before = readFileSync(path, "utf8");
    expect(() =>
      handleCcsopConfigure(path, {
        action: "status",
        flow: "codex+codex",
      }),
    ).toThrow();
    expect(() =>
      handleCcsopConfigure(path, {
        action: "stamp-schema-v1",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        model: "should-not-be-accepted",
      }),
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("replaces only an existing scalar token and preserves surrounding bytes", () => {
    const before =
      '[review.codex]\n  model  =   "old" \t # consumer spacing/comment\nunknown = "x#y"\n';
    expect(
      applyTomlUpdates(before, [
        { section: "review.codex", key: "model", value: "new" },
      ]),
    ).toBe(
      '[review.codex]\n  model  =   "new" \t # consumer spacing/comment\nunknown = "x#y"\n',
    );
  });

  it("rejects malformed or duplicate TOML with zero config writes", () => {
    const { path } = fixture(1);
    const duplicate = readFileSync(path, "utf8").replace(
      '[collaboration]\nautonomy = "gated"',
      '[collaboration]\nautonomy = "gated"\nautonomy = "full-auto"',
    );
    writeFileSync(path, duplicate, "utf8");
    expect(() =>
      handleCcsopConfigure(path, {
        action: "status",
      }),
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe(duplicate);
  });

  it.each([
    "after-backup",
    "after-temp-fsync",
    "after-rename",
    "after-verify",
  ] satisfies ConfigWriteFaultPoint[])(
    "restores exact config bytes after an injected %s fault",
    (faultAt) => {
      const { path } = fixture(1);
      chmodSync(path, 0o640);
      const before = readFileSync(path, "utf8");
      const candidate = applyTomlUpdates(before, [
        { section: "collaboration", key: "design_owner", value: "codex" },
      ]);
      expect(() =>
        writeConfigAtomically(path, before, candidate, { faultAt }),
      ).toThrow(/injected config writer fault/);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(statSync(path).mode & 0o777).toBe(0o640);
    },
  );

  it("rechecks the CAS snapshot immediately before publish", () => {
    const { path } = fixture(1);
    const before = readFileSync(path, "utf8");
    const candidate = applyTomlUpdates(before, [
      { section: "collaboration", key: "design_owner", value: "codex" },
    ]);
    const concurrent = `${before}# concurrent writer\n`;
    writeFileSync(path, concurrent, "utf8");
    expect(() => writeConfigAtomically(path, before, candidate)).toThrow(
      /changed after snapshot/,
    );
    expect(readFileSync(path, "utf8")).toBe(concurrent);
  });

  it("preserves the config file mode across a successful atomic publish", () => {
    const { path } = fixture(1);
    chmodSync(path, 0o640);
    handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      flow: "codex+codex",
    });
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(
      existsSync(join(join(path, ".."), ".config.toml.ccsop.lock")),
    ).toBe(false);
  });

  it("rejects a symlinked backup control directory with zero config writes", () => {
    const { dir, path } = fixture(1);
    const redirected = join(dir, "redirected-backups");
    mkdirSync(redirected);
    symlinkSync(redirected, join(dir, ".ccsop"));
    const before = readFileSync(path, "utf8");
    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-flow",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        flow: "codex+codex",
      }),
    ).toThrow(/must not be a symlink/);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(statSync(redirected).isDirectory()).toBe(true);
  });

  it("serializes config mutations through an exclusive lock", () => {
    const { path } = fixture(1);
    const lockPath = join(
      join(path, ".."),
      ".config.toml.ccsop.lock",
    );
    writeFileSync(lockPath, "other-writer\n", "utf8");
    const before = readFileSync(path, "utf8");
    expect(() =>
      handleCcsopConfigure(path, {
        action: "set-flow",
        expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
        flow: "codex+codex",
      }),
    ).toThrow(/config mutation lock is busy/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("recovers a dead-pid mutation lock before writing", () => {
    const { path } = fixture(1);
    const lockPath = join(join(path, ".."), ".config.toml.ccsop.lock");
    writeFileSync(lockPath, "99999999\n", "utf8");
    const result = handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      flow: "codex+codex",
    });
    expect(result.ok).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("places backups under the configured repository root", () => {
    const { dir, path } = fixture(1);
    const repoRoot = join(dir, "configured-root");
    mkdirSync(repoRoot);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        'repo_root = ".."',
        'repo_root = "../configured-root"',
      ),
      "utf8",
    );
    const result = handleCcsopConfigure(path, {
      action: "set-flow",
      expected_config_sha256: new RuntimeConfigStore(path).inspect().sha256,
      flow: "codex+codex",
    });
    expect(result.backup_path).toMatch(
      new RegExp(`^${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.ccsop/backups/config/`),
    );
    expect(readFileSync(result.backup_path!, "utf8")).toContain(
      'repo_root = "../configured-root"',
    );
  });

  it("reloads the config on every inspect instead of retaining startup state", () => {
    const { path } = fixture(1);
    const store = new RuntimeConfigStore(path);
    const first = store.loadValidated();
    expect(first.config.collaboration.design_owner).toBeUndefined();
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "[collaboration]\nautonomy",
        '[collaboration]\ndesign_owner = "codex"\nautonomy',
      ),
      "utf8",
    );
    const second = store.loadValidated();
    expect(second.sha256).not.toBe(first.sha256);
    expect(second.config.collaboration.design_owner).toBe("codex");
  });

  it("keeps the published Phase 1 machine contract free of Claude implement tokens", () => {
    const rendered = JSON.stringify(CONTROL_SURFACE_CONTRACT_V1);
    expect(rendered).not.toContain("claude-implement");
    expect(rendered).not.toContain("claude_implement");
    expect(rendered).not.toContain("implement.claude");
  });
});
