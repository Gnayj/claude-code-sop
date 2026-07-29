import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BlobStore,
  buildSnapshot,
} from "../src/implement-workspace.js";
import { makeTempDir, rmDir } from "./test-helpers.js";

const roots: string[] = [];
const script = resolve(
  import.meta.dirname,
  "../scripts/migrate-implement-state.mjs",
);

function fixture(): { root: string; statePath: string } {
  const root = makeTempDir("ccsop-state-migrate-");
  roots.push(root);
  const dir = join(root, ".codex-review", "implement-state");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "legacy.implement.json");
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        design_id: "legacy",
        tool_class: "implement",
        rounds: 1,
        tokens_used_estimate_total: 10,
        codex_failure_streak: 0,
        parser_failure_streak: 0,
        dispatches: [
          {
            dispatch_key: "d",
            payload_sha: "a".repeat(64),
            artifact_id: "b".repeat(32),
            round: 1,
            lifecycle: "failed",
            epoch_pid: 1,
            epoch_started_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return { root, statePath };
}

afterEach(() => {
  while (roots.length > 0) rmDir(roots.pop()!);
});

describe("implement-state migration CLI", () => {
  it("archives and backfills legacy Codex identity, then performs a compatible downgrade", () => {
    const { root, statePath } = fixture();
    execFileSync(process.execPath, [script, "--to-v2", "--repo", root]);
    let state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.schema_version).toBe(2);
    expect(state.writer_kind).toBe("codex");
    expect(state.dispatches[0].writer_kind).toBe("codex");
    expect(state.dispatches[0].payload_schema_version).toBe(1);
    expect(
      readdirSync(
        join(root, ".codex-review", "implement-state-migration-archive"),
      ).some((name) => name.endsWith(".implement-v1.json")),
    ).toBe(true);

    execFileSync(process.execPath, [script, "--to-v1", "--repo", root]);
    state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.schema_version).toBeUndefined();
    expect(state.writer_kind).toBeUndefined();
    expect(state.dispatches[0].writer_kind).toBeUndefined();
  });

  it("refuses to disguise a Claude/v2 dispatch as legacy", () => {
    const { root, statePath } = fixture();
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.schema_version = 2;
    state.writer_kind = "claude";
    state.dispatches[0].writer_kind = "claude";
    state.dispatches[0].payload_schema_version = 2;
    writeFileSync(statePath, JSON.stringify(state));
    expect(() =>
      execFileSync(process.execPath, [script, "--to-v1", "--repo", root], {
        stdio: "pipe",
      }),
    ).toThrow(/cannot downgrade non-Codex|cannot disguise/);
  });
});

describe("provider-specific snapshot domain", () => {
  it("preserves the legacy Codex domain while allowing Claude to exclude server-private control state", () => {
    const root = makeTempDir("ccsop-snapshot-provider-");
    const blobs = makeTempDir("ccsop-snapshot-provider-blobs-");
    roots.push(root, blobs);
    execFileSync("git", ["init", "-q"], { cwd: root });
    mkdirSync(join(root, ".codex-review"), { recursive: true });
    writeFileSync(join(root, ".codex-review/config.toml"), "tracked-control\n");
    writeFileSync(join(root, "src.txt"), "source\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    mkdirSync(join(blobs, "codex"), { recursive: true });
    mkdirSync(join(blobs, "claude"), { recursive: true });

    const codex = buildSnapshot(
      root,
      ["src.txt"],
      new BlobStore(join(blobs, "codex")),
    ).snapshot;
    const claude = buildSnapshot(
      root,
      ["src.txt"],
      new BlobStore(join(blobs, "claude")),
      {
        excludePath: (path) =>
          path === ".codex-review" || path.startsWith(".codex-review/"),
      },
    ).snapshot;

    expect(codex.inventory.has(".codex-review/config.toml")).toBe(true);
    expect(claude.inventory.has(".codex-review/config.toml")).toBe(false);
    expect(claude.inventory.has("src.txt")).toBe(true);
  });
});
