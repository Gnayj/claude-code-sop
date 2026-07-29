import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ConfigSchema } from "../src/config.js";
import { provideDiff } from "../src/diff-provision.js";

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "diff-provision-"));
  tempDirs.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  return root;
}

function commit(root: string, message: string): void {
  git(root, "add", ".");
  git(root, "commit", "-m", message);
}

function twoCommitRepo(files: Record<string, [string, string]>): string {
  const root = repo();
  for (const [name, [before]] of Object.entries(files)) {
    writeFileSync(join(root, name), before);
  }
  commit(root, "before");
  for (const [name, [, after]] of Object.entries(files)) {
    writeFileSync(join(root, name), after);
  }
  commit(root, "after");
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("provideDiff", () => {
  // Built once and shared across the valid-spec matrix: provideDiff only reads the repo,
  // and per-case rebuilds cost ~13 git spawns each. Cleaned in afterAll (NOT tempDirs —
  // the afterEach there would remove it between parameterized cases).
  let validSpecRoot: string;
  beforeAll(() => {
    validSpecRoot = mkdtempSync(join(tmpdir(), "diff-provision-shared-"));
    git(validSpecRoot, "init", "-b", "main");
    git(validSpecRoot, "config", "user.email", "test@example.com");
    git(validSpecRoot, "config", "user.name", "Test");
    writeFileSync(join(validSpecRoot, "tracked.txt"), "zero\n");
    commit(validSpecRoot, "zero");
    for (let i = 1; i <= 3; i += 1) {
      writeFileSync(join(validSpecRoot, "tracked.txt"), `${i}\n`);
      commit(validSpecRoot, String(i));
    }
    git(validSpecRoot, "branch", "abc123");
    git(validSpecRoot, "branch", "def456");
  });
  afterAll(() => rmSync(validSpecRoot, { recursive: true, force: true }));

  it.each(["main...HEAD", "abc123..def456", "HEAD~3", "HEAD"])(
    "accepts valid single-token spec %s",
    (spec) => {
      expect(() => provideDiff(spec, [], validSpecRoot, 64 * 1024)).not.toThrow();
    },
  );

  it.each(["-HEAD", "HEAD main", "HEAD\tmain", ""])(
    "rejects invalid spec %j before invoking Git",
    (spec) => {
      expect(() => provideDiff(spec, [], "/not/a/repository", 1024)).toThrow(
        /committed Git revision range.*one token.*main\.\.\.HEAD.*abc123\.\.def456.*HEAD~3/i,
      );
    },
  );

  it("disables configured external diff commands and textconv filters", () => {
    const root = repo();
    const marker = join(root, "evil-ran");
    const helper = join(root, "evil-helper");
    writeFileSync(join(root, ".gitattributes"), "*.txt diff=evil\n");
    writeFileSync(join(root, "tracked.txt"), "before\n");
    commit(root, "before");
    writeFileSync(join(root, "tracked.txt"), "after\n");
    commit(root, "after");
    writeFileSync(helper, `#!/bin/sh\ntouch "${marker}"\ncat "$1"\n`);
    chmodSync(helper, 0o755);
    git(root, "config", "diff.evil.command", helper);
    git(root, "config", "diff.evil.textconv", helper);

    const result = provideDiff("HEAD~1..HEAD", ["tracked.txt"], root, 64 * 1024);

    expect(existsSync(marker)).toBe(false);
    expect(result.block).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect(result.block).toContain("-before");
    expect(result.block).toContain("+after");
  });

  it("fails closed when changed_files contains an untracked file", () => {
    const root = repo();
    writeFileSync(join(root, "tracked.txt"), "tracked\n");
    commit(root, "initial");
    writeFileSync(join(root, "new.txt"), "untracked\n");

    expect(() => provideDiff("HEAD", ["new.txt"], root, 64 * 1024)).toThrow(
      /new\.txt.*untracked.*commit.*diff_spec/i,
    );
  });

  it("warns for each committed diff file omitted from changed_files", () => {
    const root = twoCommitRepo({
      "listed.txt": ["old\n", "new\n"],
      "omitted.txt": ["old\n", "new\n"],
    });

    const result = provideDiff("HEAD~1..HEAD", ["listed.txt"], root, 64 * 1024);

    expect(result.warnings).toEqual([
      expect.stringMatching(/omitted\.txt.*changed_files/),
    ]);
  });

  it("rejects an oversized diff without truncating it", () => {
    const root = twoCommitRepo({ "large.txt": ["short\n", `${"x".repeat(2048)}\n`] });
    expect(() => provideDiff("HEAD~1..HEAD", ["large.txt"], root, 64)).toThrow(
      /exceeding max_injected_diff_bytes=64.*Narrow.*batches.*not truncate/i,
    );
  });

  it("reports Git failures readably", () => {
    const root = mkdtempSync(join(tmpdir(), "diff-provision-nongit-"));
    tempDirs.push(root);
    expect(() => provideDiff("HEAD", [], root, 1024)).toThrow(
      /Unable to collect diff.*Git failed.*Git repository.*valid committed revisions/i,
    );
  });
});

describe("max_injected_diff_bytes config", () => {
  const minimal = {
    meta: { project_id: "p", project_name: "p", repo_root: ".", allowed_doc_roots: ["docs/"] },
    paths: {
      sop: "a", collaboration_sop: "b", handoff: "c", plans_active: "d",
      plans_completed: "e", sessions_dir: "f", backlog_dir: "g", archive_dir: "h",
    },
    review: {
      design: { prompt_template: "t", verdict_enum: ["Go", "No-Go"] },
      code: { prompt_template: "t", verdict_enum: ["Pass", "No-Go"] },
      fix: { prompt_template: "t", verdict_enum: ["All-fixed", "No-Go"] },
    },
  };

  it("defaults to 262144 and rejects non-positive values", () => {
    expect(ConfigSchema.parse(minimal).review.max_injected_diff_bytes).toBe(262144);
    expect(() =>
      ConfigSchema.parse({
        ...minimal,
        review: { ...minimal.review, max_injected_diff_bytes: 0 },
      }),
    ).toThrow();
  });
});
