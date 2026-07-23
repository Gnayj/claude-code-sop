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
import { defaultConfig, defaultFactors, makeCodexProvider, makeEnvelope, makeTempDir, rmDir } from "../test-helpers.js";

class AlwaysFailingCodex implements CodexClient {
  failures = 0;
  async startThread(): Promise<ThreadHandle> {
    return {
      threadId: "thr_fail",
      runTurn: async (): Promise<RunTurnResult> => {
        this.failures++;
        throw new Error("simulated SDK outage");
      },
    };
  }
  async resumeThread(): Promise<ThreadHandle> {
    return this.startThread();
  }
  async ping(): Promise<void> {}
}

function setup(): {
  root: string;
  config: ReturnType<typeof defaultConfig>;
  cleanup: () => void;
} {
  const root = makeTempDir("codex-review-fault-");
  mkdirSync(join(root, ".codex-review/sessions"), { recursive: true });
  mkdirSync(join(root, ".codex-review/archive"), { recursive: true });
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, ".codex-review/templates/design-review.md.tpl"),
    "# design tpl\n",
    "utf8",
  );
  writeFileSync(
    join(root, ".codex-review/templates/code-review.md.tpl"),
    "# code tpl\n",
    "utf8",
  );
  writeFileSync(
    join(root, ".codex-review/templates/fix-review.md.tpl"),
    "# fix tpl\n",
    "utf8",
  );
  writeFileSync(join(root, "docs/d.md"), "x", "utf8");
  const config = defaultConfig({
    meta: {
      project_id: "fault",
      project_name: "fault",
      language: "zh-CN",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  return { root, config, cleanup: () => rmDir(root) };
}

describe("fault-injection: codex_unavailable after 3 SDK failures", () => {
  it("trips breaker on streak", async () => {
    const { root, config, cleanup } = setup();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new AlwaysFailingCodex();

      // First two failures: caller catches throw and retries.
      for (let i = 0; i < 2; i++) {
        let threw = false;
        try {
          await runReviewFlow(
            {
              config,
              configBaseDir: root,
              providerFor: () => makeCodexProvider(codex),
              threadManager: tm,
              promptRenderer: renderer,
              breakers,
              breakerState,
            },
            {
              stage: "design",
              designId: `fail-${i}`,
              designDocPaths: ["docs/d.md"],
              fileBlocks: [],
              promptVars: {},
              hasPreviousRoundResolved: false,
              forceNewThread: false,
            },
          );
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
      }
      expect(breakerState.codex_failure_streak).toBe(2);

      // Third failure: tripped breaker returned in result (no throw).
      const r = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          providerFor: () => makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "fail-3",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: {},
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r.ok).toBe(false);
      expect(r.breakerTripped?.name).toBe("codex_unavailable");
    } finally {
      cleanup();
    }
  });
});

describe("fault-injection: parser_unavailable after 3 unparseable outputs", () => {
  it("trips breaker on streak", async () => {
    const { root, config, cleanup } = setup();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();

      // Mock client that returns garbage.
      const garbageCodex: CodexClient = {
        startThread: async (): Promise<ThreadHandle> => ({
          threadId: "thr_garbage",
          runTurn: async () => ({ text: "this is not json", usage: null }),
        }),
        resumeThread: async (id: string): Promise<ThreadHandle> => ({
          threadId: id,
          runTurn: async () => ({ text: "still not json", usage: null }),
        }),
        ping: async () => undefined,
      };

      let lastResult;
      for (let i = 0; i < 3; i++) {
        lastResult = await runReviewFlow(
          {
            config,
            configBaseDir: root,
            providerFor: () => makeCodexProvider(garbageCodex),
            threadManager: tm,
            promptRenderer: renderer,
            breakers,
            breakerState,
          },
          {
            stage: "design",
            designId: "garbage",
            designDocPaths: ["docs/d.md"],
            fileBlocks: [],
            promptVars: {},
            hasPreviousRoundResolved: false,
            forceNewThread: i > 0 ? false : false,
          },
        );
        expect(lastResult.ok).toBe(false);
      }
      expect(lastResult?.breakerTripped?.name).toBe("parser_unavailable");
    } finally {
      cleanup();
    }
  });
});

describe("fault-injection: high context usage triggers thread rebuild + cold-start + context_exhausted breaker", () => {
  /** Build a CodexClient that records every prompt seen and returns a fixed envelope text. */
  function makePromptRecordingCodex(replyTextSequence: string[]): {
    client: CodexClient;
    seenPrompts: string[];
    startedThreads: number;
    resumedThreads: number;
  } {
    const seen: string[] = [];
    const ctr = { started: 0, resumed: 0 };
    const client: CodexClient = {
      startThread: async (): Promise<ThreadHandle> => {
        ctr.started++;
        const tid = `thr_h${ctr.started}`;
        return {
          threadId: tid,
          runTurn: async (input: string) => {
            seen.push(input);
            const text = replyTextSequence.shift();
            if (!text) throw new Error("out of scripted replies");
            return { text, usage: { inputTokens: 50000, outputTokens: 1000, totalTokens: 51000 } };
          },
        };
      },
      resumeThread: async (threadId: string): Promise<ThreadHandle> => {
        ctr.resumed++;
        return {
          threadId,
          runTurn: async (input: string) => {
            seen.push(input);
            const text = replyTextSequence.shift();
            if (!text) throw new Error("out of scripted replies");
            return { text, usage: { inputTokens: 50000, outputTokens: 1000, totalTokens: 51000 } };
          },
        };
      },
      ping: async () => undefined,
    };
    return {
      client,
      seenPrompts: seen,
      get startedThreads() {
        return ctr.started;
      },
      get resumedThreads() {
        return ctr.resumed;
      },
    } as unknown as ReturnType<typeof makePromptRecordingCodex>;
  }

  it("first call usage=0.85 emits force-rebuild warning; second call rebuilds + injects cold-start; if usage still high triggers context_exhausted", async () => {
    const { root, config, cleanup } = setup();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();

      // Round 1 returns 0.85 usage with a memorable summary.
      // Round 2 returns 0.7 usage (still >= 0.6 warn) — should trigger context_exhausted post-rebuild.
      const round1 = JSON.stringify(
        makeEnvelope("design", "Go", {
          verdict_factors: defaultFactors(),
          context_usage_pct: 0.85,
          compact_summary_for_round: "ROUND1_SUMMARY_MARKER",
        }),
      );
      const round2 = JSON.stringify(
        makeEnvelope("design", "Go", {
          verdict_factors: defaultFactors(),
          context_usage_pct: 0.7,
          compact_summary_for_round: "ROUND2_SUMMARY",
        }),
      );
      const codexBundle = makePromptRecordingCodex([round1, round2]);

      // Round 1 run.
      const r1 = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          providerFor: () => makeCodexProvider(codexBundle.client),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "heavy",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: {},
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r1.ok).toBe(true);
      expect(r1.didRebuildThread).toBe(false);
      expect(r1.warnings.some((w) => /force-rebuild/.test(w))).toBe(true);

      // Round 2 run — should trigger rebuild AND context_exhausted.
      const r2 = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          providerFor: () => makeCodexProvider(codexBundle.client),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "design",
          designId: "heavy",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: {},
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r2.ok).toBe(true);
      expect(r2.didRebuildThread).toBe(true);
      expect(r2.breakerTripped?.name).toBe("context_exhausted");
      // Cold-start preface must contain ROUND1's summary marker so Codex sees historical context.
      const r2Prompt = codexBundle.seenPrompts[1];
      expect(r2Prompt).toBeDefined();
      expect(r2Prompt).toMatch(/冷启动上下文/);
      expect(r2Prompt).toMatch(/ROUND1_SUMMARY_MARKER/);
    } finally {
      cleanup();
    }
  });
});

describe("fault-injection: scope_drift breaker fires when cumulative fix lines exceed threshold", () => {
  function makeFixCodex(replyText: string): CodexClient {
    return {
      startThread: async (): Promise<ThreadHandle> => ({
        threadId: "thr_fix_1",
        runTurn: async () => ({
          text: replyText,
          usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
        }),
      }),
      resumeThread: async (id: string): Promise<ThreadHandle> => ({
        threadId: id,
        runTurn: async () => ({
          text: replyText,
          usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
        }),
      }),
      ping: async () => undefined,
    };
  }

  it("two fix rounds of 120 lines each (threshold=200) trip on the second", async () => {
    const { root, config, cleanup } = setup();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();

      const fixReply = JSON.stringify(
        makeEnvelope("fix", "All-fixed", {
          verdict_factors: defaultFactors(),
        }),
      );
      const codex = makeFixCodex(fixReply);

      const flowDeps = {
        config,
        configBaseDir: root,
        providerFor: () => makeCodexProvider(codex),
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState,
      };
      const baseInput = {
        stage: "fix" as const,
        designId: "scope-drift-d1",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: {},
        hasPreviousRoundResolved: true,
        forceNewThread: false,
      };

      // First fix round: 120 lines — under 200 threshold, total becomes 120.
      const r1 = await runReviewFlow(flowDeps, { ...baseInput, fixDiffLines: 120 });
      expect(r1.ok).toBe(true);
      expect(r1.breakerTripped).toBeUndefined();

      // Second fix round: another 120 lines — total 240, which crosses 200 threshold.
      const r2 = await runReviewFlow(flowDeps, { ...baseInput, fixDiffLines: 120 });
      expect(r2.ok).toBe(false);
      expect(r2.breakerTripped?.name).toBe("scope_drift");

      // Persisted state should reflect the cumulative drift.
      const persisted = tm.read("scope-drift-d1");
      expect(persisted?.scope_drift_lines_total).toBe(120);
    } finally {
      cleanup();
    }
  });
});

describe("fault-injection: lock timeout serializes concurrent calls", () => {
  it("acquires & releases without contention; second concurrent acquisition fails", async () => {
    const { root, cleanup } = setup();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 1,
      });
      const release = tm.acquireLock("d1");
      try {
        const tm2 = new ThreadManager({
          sessionsDir: join(root, ".codex-review/sessions"),
          archiveDir: join(root, ".codex-review/archive"),
          lockTimeoutSeconds: 1,
        });
        expect(() => tm2.acquireLock("d1")).toThrow(/timeout/);
      } finally {
        release();
      }
    } finally {
      cleanup();
    }
  });
});
