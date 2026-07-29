import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedConfig } from "../src/config.js";
import { ImplementLedger } from "../src/implement-ledger.js";
import { makeTempDir, rmDir } from "./test-helpers.js";

const dirs: string[] = [];

function fixture(
  now: Date | (() => Date) = new Date("2026-07-29T12:00:00Z"),
): {
  root: string;
  ledger: ImplementLedger;
} {
  const root = makeTempDir("ccsop-ledger-");
  dirs.push(root);
  mkdirSync(join(root, ".codex-review"));
  return {
    root,
    ledger: new ImplementLedger(root, () =>
      typeof now === "function" ? now() : now,
    ),
  };
}

const config = {
  enabled: true,
  backend: "cli",
  model: "opus",
  effort: "max",
  cli_path: "",
  timeout_seconds: 10,
  max_output_bytes: 1024,
  max_budget_usd: 2,
  supported_version_range: ">=2.1.220 <2.2.0",
  allow_uncertified_version: false,
  max_dispatches_per_design: 2,
  max_cumulative_wall_seconds: 20,
  max_cumulative_budget_usd: 4,
  max_daily_budget_usd: 5,
  validation_commands: [],
  validation_definition_paths: [],
  validation_additive_test_globs: [],
  allow_advisory_apply: false,
} satisfies ResolvedConfig["implement"]["claude"];

afterEach(() => {
  while (dirs.length > 0) rmDir(dirs.pop()!);
});

describe("durable Claude implement ledger", () => {
  it("reserves before spawn, settles conservatively, and enforces design/daily caps", async () => {
    const { ledger } = fixture();
    const first = await ledger.reserve({
      designId: "d",
      artifactId: "a".repeat(32),
      writerKind: "claude",
      config,
      allowCreate: true,
      lockTimeoutMs: 1000,
    });
    await ledger.settle(first, { wallSeconds: 3, budgetUsd: 1.25 }, 1000);
    const replay = await ledger.reserve({
      designId: "d",
      artifactId: "a".repeat(32),
      writerKind: "claude",
      config,
      allowCreate: false,
      lockTimeoutMs: 1000,
    });
    expect(replay).toEqual(first);

    const second = await ledger.reserve({
      designId: "d",
      artifactId: "b".repeat(32),
      writerKind: "claude",
      config,
      allowCreate: false,
      lockTimeoutMs: 1000,
    });
    await ledger.settle(second, { wallSeconds: 9, budgetUsd: 2 }, 1000);
    await expect(
      ledger.reserve({
        designId: "d",
        artifactId: "c".repeat(32),
        writerKind: "claude",
        config,
        allowCreate: false,
        lockTimeoutMs: 1000,
      }),
    ).rejects.toThrow(/max_dispatches_per_design/);
    const state = ledger.readForTest()!;
    expect(state.designs.d.dispatch_count).toBe(2);
    expect(state.designs.d.wall_seconds).toBe(12);
    expect(state.designs.d.budget_usd).toBe(3.25);
  });

  it("rejects absent referenced ledgers and cross-writer design reuse", async () => {
    const { ledger } = fixture();
    await expect(
      ledger.reserve({
        designId: "known",
        artifactId: "a".repeat(32),
        writerKind: "claude",
        config,
        allowCreate: false,
        lockTimeoutMs: 1000,
      }),
    ).rejects.toThrow(/absent while implement state already references/);

    await ledger.reserve({
      designId: "known",
      artifactId: "a".repeat(32),
      writerKind: "claude",
      config,
      allowCreate: true,
      lockTimeoutMs: 1000,
    });
    await expect(
      ledger.reserve({
        designId: "known",
        artifactId: "b".repeat(32),
        writerKind: "codex",
        config,
        allowCreate: false,
        lockTimeoutMs: 1000,
      }),
    ).rejects.toThrow(/owned by writer_kind=claude/);
  });

  it("fails closed and quarantines corrupt or future ledgers", async () => {
    const corrupt = fixture();
    const path = join(corrupt.root, ".codex-review", "implement-ledger.json");
    writeFileSync(path, "{broken", "utf8");
    await expect(
      corrupt.ledger.reserve({
        designId: "d",
        artifactId: "a".repeat(32),
        writerKind: "claude",
        config,
        allowCreate: false,
        lockTimeoutMs: 1000,
      }),
    ).rejects.toThrow(/corrupt.*quarantined/);
    expect(existsSync(path)).toBe(false);

    const future = fixture();
    const futurePath = join(
      future.root,
      ".codex-review",
      "implement-ledger.json",
    );
    writeFileSync(
      futurePath,
      JSON.stringify({
        schema_version: 2,
        last_utc_day: "2026-07-29",
        designs: {},
        days: {},
      }),
      "utf8",
    );
    await expect(
      future.ledger.reserve({
        designId: "d",
        artifactId: "a".repeat(32),
        writerKind: "claude",
        config,
        allowCreate: false,
        lockTimeoutMs: 1000,
      }),
    ).rejects.toThrow(/unsupported schema_version=2/);
  });

  it("does not replenish a daily bucket when the wall clock rolls backward", async () => {
    let now = new Date("2026-07-30T00:01:00Z");
    const { ledger } = fixture(() => now);
    await ledger.reserve({
      designId: "d1",
      artifactId: "a".repeat(32),
      writerKind: "claude",
      config,
      allowCreate: true,
      lockTimeoutMs: 1000,
    });
    now = new Date("2026-07-29T23:59:00Z");
    await ledger.reserve({
      designId: "d2",
      artifactId: "b".repeat(32),
      writerKind: "claude",
      config,
      allowCreate: false,
      lockTimeoutMs: 1000,
    });
    expect(ledger.readForTest()!.last_utc_day).toBe("2026-07-30");
    expect(ledger.readForTest()!.days["2026-07-30"]!.reserved_budget_usd).toBe(4);
  });
});
