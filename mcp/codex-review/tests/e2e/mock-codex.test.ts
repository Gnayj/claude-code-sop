import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexClient, RunTurnResult, ThreadHandle } from "../../src/codex-client.js";
import {
  BreakerEngine,
  initialBreakerState,
} from "../../src/circuit-breakers.js";
import { PromptRenderer } from "../../src/prompt-renderer.js";
import { ThreadManager } from "../../src/thread-manager.js";
import { runReviewFlow } from "../../src/run-review-flow.js";
import { defaultConfig, defaultFactors, makeCodexProvider, makeConclusion, makeEnvelope, makeTempDir, rmDir } from "../test-helpers.js";

class MockCodex implements CodexClient {
  threadCounter = 0;
  scriptedReplies: string[] = [];
  failuresUntilSuccess = 0;
  startedThreads = 0;
  resumedThreads = 0;

  async startThread(): Promise<ThreadHandle> {
    this.startedThreads++;
    const id = `thr_mock_${++this.threadCounter}`;
    return this.makeThread(id);
  }
  async resumeThread(threadId: string): Promise<ThreadHandle> {
    this.resumedThreads++;
    return this.makeThread(threadId);
  }
  async ping(): Promise<void> {}

  private makeThread(id: string): ThreadHandle {
    const self = this;
    return {
      threadId: id,
      async runTurn(_input: string): Promise<RunTurnResult> {
        if (self.failuresUntilSuccess > 0) {
          self.failuresUntilSuccess--;
          throw new Error("mock SDK transient failure");
        }
        const text = self.scriptedReplies.shift() ?? "";
        if (!text) throw new Error("mock SDK out of scripted replies");
        return {
          text,
          usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 },
        };
      },
    };
  }
}

function setupTempProject(): {
  root: string;
  cleanup: () => void;
  config: ReturnType<typeof defaultConfig>;
  baseDir: string;
} {
  const root = makeTempDir("codex-review-e2e-");
  mkdirSync(join(root, ".codex-review/sessions"), { recursive: true });
  mkdirSync(join(root, ".codex-review/archive"), { recursive: true });
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, ".codex-review/templates/design-review.md.tpl"),
    "# design tpl\n{{design_id}}\n",
    "utf8",
  );
  writeFileSync(
    join(root, ".codex-review/templates/code-review.md.tpl"),
    "# code tpl\n{{design_id}}\n",
    "utf8",
  );
  writeFileSync(
    join(root, ".codex-review/templates/fix-review.md.tpl"),
    "# fix tpl\n{{design_id}}\n",
    "utf8",
  );
  writeFileSync(join(root, "docs/d.md"), "design content v1", "utf8");
  writeFileSync(join(root, "docs/task.md"), "task card", "utf8");
  writeFileSync(join(root, "docs/handoff.md"), "handoff", "utf8");

  const config = defaultConfig({
    meta: {
      project_id: "e2e",
      project_name: "e2e",
      language: "zh-CN",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  return {
    root,
    baseDir: root,
    config,
    cleanup: () => rmDir(root),
  };
}

describe("e2e: design-review + drift inject + code-review + fix-review (mock SDK)", () => {
  it("runs three rounds and persists state correctly", async () => {
    const { root, baseDir, config, cleanup } = setupTempProject();
    try {
      const sessionsDir = join(root, ".codex-review/sessions");
      const archiveDir = join(root, ".codex-review/archive");
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir,
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new MockCodex();

      // Round 1: design Go-after-fixes (factors-consistent).
      codex.scriptedReplies.push(
        JSON.stringify(
          makeEnvelope("design", "Go-after-fixes", {
            verdict_factors: defaultFactors({
              important_count: 2,
              affected_major_sections_count: 1,
            }),
            conclusions: [makeConclusion("Important"), makeConclusion("Important")],
            next_action: "fix-required",
          }),
        ),
      );

      const r1 = await runReviewFlow(
        {
          config,
          configBaseDir: baseDir,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "e2e-d1",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [
            { label: "Task", path: "docs/task.md" },
            { label: "Handoff", path: "docs/handoff.md" },
          ],
          promptVars: { design_id: "e2e-d1" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r1.ok).toBe(true);
      expect(r1.envelope?.verdict).toBe("Go-after-fixes");
      expect(codex.startedThreads).toBe(1);

      // Round 2: design doc updated -> drift preface should appear.
      writeFileSync(join(root, "docs/d.md"), "design content v2 — updated", "utf8");
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("design", "Go", { next_action: "ready-to-implement" })),
      );
      const r2 = await runReviewFlow(
        {
          config,
          configBaseDir: baseDir,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "e2e-d1",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "e2e-d1" },
          hasPreviousRoundResolved: true,
          forceNewThread: false,
        },
      );
      expect(r2.ok).toBe(true);
      expect(r2.envelope?.verdict).toBe("Go");
      expect(codex.resumedThreads).toBe(1);

      // Round 3: code-review Pass.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { next_action: "ready-to-test" })),
      );
      const r3 = await runReviewFlow(
        {
          config,
          configBaseDir: baseDir,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "code",
          designId: "e2e-d1",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "e2e-d1" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r3.ok).toBe(true);
      expect(r3.envelope?.verdict).toBe("Pass");

      // State should reflect 2 design rounds + 1 code round.
      const state = tm.read("e2e-d1");
      expect(state?.rounds.design_review).toBe(2);
      expect(state?.rounds.code_review).toBe(1);
      expect(state?.rounds.history.length).toBe(3);
    } finally {
      cleanup();
    }
  });
});

describe("e2e: server-authoritative envelope.thread_id and review_id (override Codex self-fill)", () => {
  it("overrides envelope thread_id with real wrapThread.threadId; review_id matches server format", async () => {
    const { root, baseDir, config, cleanup } = setupTempProject();
    try {
      const sessionsDir = join(root, ".codex-review/sessions");
      const archiveDir = join(root, ".codex-review/archive");
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir,
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new MockCodex();
      // Codex tries to self-fill garbage values; server must override both.
      codex.scriptedReplies.push(
        JSON.stringify(
          makeEnvelope("design", "Go", {
            thread_id: "mock_codex_made_up_thread_id_xxx",
            review_id: "mock_codex_made_up_review_id_yyy",
            verdict_factors: defaultFactors(),
            next_action: "ready-to-implement",
          }),
        ),
      );

      const r = await runReviewFlow(
        {
          config,
          configBaseDir: baseDir,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "thread-id-consistency-d1",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "thread-id-consistency-d1" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r.ok).toBe(true);
      // thread_id must equal the mock thread's actual id, not Codex's self-fill.
      expect(r.envelope?.thread_id).toBe("thr_mock_1");
      expect(r.envelope?.thread_id).not.toBe("mock_codex_made_up_thread_id_xxx");
      // review_id must match server format rev_<design_id>_<stage>_<round>_<4-hex>.
      expect(r.envelope?.review_id).toMatch(
        /^rev_thread-id-consistency-d1_design_1_[0-9a-f]{4}$/,
      );
      expect(r.envelope?.review_id).not.toBe("mock_codex_made_up_review_id_yyy");
      // Persisted state must match the envelope's authoritative values.
      const state = tm.read("thread-id-consistency-d1");
      expect(state?.thread_id).toBe(r.envelope?.thread_id);
      expect(state?.rounds.history[0]?.review_id).toBe(r.envelope?.review_id);
    } finally {
      cleanup();
    }
  });
});

describe("e2e: parser force-upgrade rounds counted, mock returns stale enum -> rejected", () => {
  it("rejects old enum and increments parser_failure streak", async () => {
    const { root, baseDir, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new MockCodex();

      const oldEnumEnv = JSON.stringify({
        ...makeEnvelope("design", "Go"),
        verdict: "Go-with-required-changes",
      });
      codex.scriptedReplies.push(oldEnumEnv);

      const r = await runReviewFlow(
        {
          config,
          configBaseDir: baseDir,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "e2e-old-enum",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "e2e-old-enum" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r.ok).toBe(false);
      expect(r.parseResult.ok).toBe(false);
      if (!r.parseResult.ok) {
        expect(r.parseResult.reason).toBe("old_verdict_rejected");
      }
      expect(breakerState.parser_failure_streak).toBe(1);
    } finally {
      cleanup();
    }
  });
});
