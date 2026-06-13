import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ThreadManager, ThreadLockTimeoutError } from "../src/thread-manager.js";
import { makeTempDir, rmDir } from "./test-helpers.js";

describe("ThreadManager state file round-trip", () => {
  it("writes & reads state atomically", () => {
    const dir = makeTempDir();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(dir, "sessions"),
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      const fresh = tm.newState("design-A", "thr_abc");
      tm.write(fresh);
      const loaded = tm.read("design-A");
      expect(loaded?.thread_id).toBe("thr_abc");
      expect(loaded?.rounds.history).toEqual([]);
    } finally {
      rmDir(dir);
    }
  });

  it("recordRound bumps stage counter and appends history", () => {
    const dir = makeTempDir();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(dir, "sessions"),
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      const s = tm.newState("d1", "thr_x");
      const updated = tm.recordRound(s, {
        review_id: "rev_d1_design_1_aaaa",
        stage: "design",
        round: 1,
        verdict: "Go-after-fixes",
        compact_summary: "round 1",
        tokens_used_estimate: 1000,
        ended_at: "2026-05-05T10:00:00+08:00",
      });
      expect(updated.rounds.design_review).toBe(1);
      expect(updated.rounds.history.length).toBe(1);
      expect(updated.tokens_used_estimate_total).toBe(1000);
    } finally {
      rmDir(dir);
    }
  });

  it("acquireLock prevents concurrent writes; throws after timeout", () => {
    const dir = makeTempDir();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(dir, "sessions"),
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      const release1 = tm.acquireLock("d1");
      try {
        // Simulate a second acquirer with a tiny timeout.
        const tm2 = new ThreadManager({
          sessionsDir: join(dir, "sessions"),
          archiveDir: join(dir, "archive"),
          lockTimeoutSeconds: 1,
        });
        expect(() => tm2.acquireLock("d1")).toThrow(ThreadLockTimeoutError);
      } finally {
        release1();
      }
      // After release, can acquire again.
      const release3 = tm.acquireLock("d1");
      release3();
    } finally {
      rmDir(dir);
    }
  });

  it("archive moves state file to archive_dir and removes original", () => {
    const dir = makeTempDir();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(dir, "sessions"),
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      const s = tm.newState("d1", "thr_x");
      tm.write(s);
      const dst = tm.archive("d1");
      expect(dst).toBeTruthy();
      expect(existsSync(tm.statePath("d1"))).toBe(false);
      if (dst) {
        const archived = JSON.parse(readFileSync(dst, "utf8"));
        expect(archived.design_id).toBe("d1");
      }
    } finally {
      rmDir(dir);
    }
  });
});
