import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { computeFileSha, planDrift, renderDriftPreface } from "../src/drift-detector.js";
import { makeTempDir, rmDir } from "./test-helpers.js";
import type { ThreadState } from "../src/types.js";

function stateWithDocs(map: Record<string, { sha: string; exists?: boolean }>): ThreadState {
  return {
    design_id: "d1",
    thread_id: "thr_x",
    thread_created_at: "2026-05-05T10:00:00+08:00",
    design_doc_files: Object.fromEntries(
      Object.entries(map).map(([k, v]) => [
        k,
        { sha: v.sha, exists: v.exists ?? true, last_seen_at: "2026-05-04T10:00:00+08:00" },
      ]),
    ),
    rounds: { design_review: 0, code_review: 0, fix_review: 0, history: [] },
    tokens_used_estimate_total: 0,
    scope_drift_lines_total: 0,
    thread_history: [],
    context_usage_pct: 0,
    archived: false,
    lock_holder_pid: null,
    lock_acquired_at: null,
  };
}

describe("drift-detector", () => {
  it("classifies unchanged / modified / added / removed", () => {
    const root = makeTempDir();
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs/a.md"), "AAA");
      writeFileSync(join(root, "docs/b.md"), "BBB-new");
      // c.md will be in state but not on disk -> still listed in input -> "removed"-ish (file missing)
      // d.md is in state but NOT in input -> classified "removed"
      const shaA = computeFileSha("AAA");
      const shaB = computeFileSha("BBB-old");
      const state = stateWithDocs({
        "docs/a.md": { sha: shaA }, // unchanged
        "docs/b.md": { sha: shaB }, // modified
        "docs/d.md": { sha: "deadbeef" }, // missing from input -> removed
      });
      const inputs = ["docs/a.md", "docs/b.md", "docs/c.md"];
      const plan = planDrift(state, inputs, (p) => join(root, p));
      const byPath = Object.fromEntries(plan.entries.map((e) => [e.path, e]));
      expect(byPath["docs/a.md"]?.category).toBe("unchanged");
      expect(byPath["docs/b.md"]?.category).toBe("modified");
      // c.md not on disk -> drift planner classifies as added (never tracked) or removed (tracked); here it's untracked-and-missing, so "added"
      expect(byPath["docs/c.md"]?.category).toBe("added");
      expect(byPath["docs/d.md"]?.category).toBe("removed");
    } finally {
      rmDir(root);
    }
  });

  it("renders drift preface with non-empty diff", () => {
    const root = makeTempDir();
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs/a.md"), "newer");
      const state = stateWithDocs({
        "docs/a.md": { sha: "00000000" },
      });
      const plan = planDrift(state, ["docs/a.md"], (p) => join(root, p));
      const preface = renderDriftPreface(plan);
      expect(preface).toContain("已更新");
      expect(preface).toContain("docs/a.md");
    } finally {
      rmDir(root);
    }
  });

  it("renders empty preface when nothing drifts", () => {
    const root = makeTempDir();
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs/a.md"), "stable");
      const sha = computeFileSha("stable");
      const state = stateWithDocs({ "docs/a.md": { sha } });
      const plan = planDrift(state, ["docs/a.md"], (p) => join(root, p));
      expect(renderDriftPreface(plan)).toBe("");
    } finally {
      rmDir(root);
    }
  });
});
