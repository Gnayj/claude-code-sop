import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

describe("ThreadManager parser-failure raw audit", () => {
  it("writes complete private content with exact path/hash/bytes and no temp residue", () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = join(dir, "sessions");
      const archiveDir = join(dir, "archive");
      const tm = new ThreadManager({ sessionsDir, archiveDir, lockTimeoutSeconds: 1 });
      const raw = "first finding\n" + "x".repeat(3000) + "\nlast finding";
      const artifact = tm.recordParserFailureRaw("design/raw", "code", raw);

      expect(artifact.path.startsWith(sessionsDir)).toBe(true);
      expect(artifact.bytes).toBe(Buffer.byteLength(raw, "utf8"));
      expect(artifact.sha256).toBe(createHash("sha256").update(raw).digest("hex"));
      expect(readFileSync(artifact.path, "utf8")).toBe(raw);
      expect(statSync(artifact.path).mode & 0o777).toBe(0o600);
      expect(readdirSync(sessionsDir).some((name) => name.includes(".tmp."))).toBe(false);
      expect(readFileSync(join(sessionsDir, ".gitignore"), "utf8")).toBe("*\n!.gitignore\n");
      expect(readFileSync(join(archiveDir, ".gitignore"), "utf8")).toBe("*\n!.gitignore\n");
    } finally {
      rmDir(dir);
    }
  });

  it("keeps at most three artifacts per design and always retains the newest", () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = join(dir, "sessions");
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      for (let index = 0; index < 3; index += 1) {
        tm.recordParserFailureRaw("d1", "code", `old-${index}`);
      }
      const newest = tm.recordParserFailureRaw("d1", "code", "newest-marker");
      const rawFiles = readdirSync(sessionsDir).filter((name) => name.endsWith(".raw.txt"));
      expect(rawFiles).toHaveLength(3);
      expect(existsSync(newest.path)).toBe(true);
      expect(readFileSync(newest.path, "utf8")).toBe("newest-marker");
    } finally {
      rmDir(dir);
    }
  });

  it("does not sweep dotted design ids that merely share a filename prefix", () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = join(dir, "sessions");
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      const dotted = tm.recordParserFailureRaw("a.b", "code", "dotted-design");
      for (let index = 0; index < 4; index += 1) {
        tm.recordParserFailureRaw("a", "code", `plain-${index}`);
      }
      expect(existsSync(dotted.path)).toBe(true);
      expect(readFileSync(dotted.path, "utf8")).toBe("dotted-design");
    } finally {
      rmDir(dir);
    }
  });

  it("enforces the 5 MiB aggregate cap while keeping an oversized newest artifact", () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = join(dir, "sessions");
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(dir, "archive"),
        lockTimeoutSeconds: 1,
      });
      const old = tm.recordParserFailureRaw("d1", "code", "a".repeat(3 * 1024 * 1024));
      const newest = tm.recordParserFailureRaw("d1", "code", "b".repeat(3 * 1024 * 1024));
      expect(existsSync(old.path)).toBe(false);
      expect(existsSync(newest.path)).toBe(true);
      expect(readdirSync(sessionsDir).filter((name) => name.endsWith(".raw.txt"))).toHaveLength(1);
    } finally {
      rmDir(dir);
    }
  });

  it("archives raw artifacts together with the thread state", () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = join(dir, "sessions");
      const archiveDir = join(dir, "archive");
      const tm = new ThreadManager({ sessionsDir, archiveDir, lockTimeoutSeconds: 1 });
      tm.write(tm.newState("d1", "thr_x"));
      const artifact = tm.recordParserFailureRaw("d1", "design", "complete raw");
      const rawName = artifact.path.split(/[\\/]/).at(-1);

      expect(tm.archive("d1")).toBeTruthy();
      expect(existsSync(artifact.path)).toBe(false);
      expect(rawName).toBeDefined();
      if (rawName) expect(readFileSync(join(archiveDir, rawName), "utf8")).toBe("complete raw");
    } finally {
      rmDir(dir);
    }
  });
});
