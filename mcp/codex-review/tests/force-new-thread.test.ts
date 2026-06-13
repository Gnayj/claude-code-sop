// Force-new-thread feature: caller-driven SDK thread reset for context_exhausted recovery.
//
// Spec source: docs/plans/active/methodology-codex-review-bridge-code-review-force-new-thread-implement.txt §6 / §8

import { describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CodeReviewInput,
  FixReviewInput,
} from "../src/types.js";
import {
  codeReviewToolName,
  codeReviewToolSchema,
  handleCodeReview,
} from "../src/tools/code-review.js";
import {
  fixReviewToolName,
  fixReviewToolSchema,
  handleFixReview,
} from "../src/tools/fix-review.js";
import {
  designReviewToolSchema,
} from "../src/tools/design-review.js";
import { runReviewFlow } from "../src/run-review-flow.js";
import {
  BreakerEngine,
  initialBreakerState,
} from "../src/circuit-breakers.js";
import { PromptRenderer } from "../src/prompt-renderer.js";
import { ThreadManager } from "../src/thread-manager.js";
import type { CodexClient, RunTurnResult, ThreadHandle } from "../src/codex-client.js";

import {
  defaultConfig,
  defaultFactors,
  makeCodexProvider,
  makeConclusion,
  makeEnvelope,
  makeTempDir,
  rmDir,
} from "./test-helpers.js";

// ---------- §8.1 #1 / #2 — zod schema accepts force_new_thread ----------

describe("§8.1 #1 — CodeReviewInput zod schema accepts force_new_thread", () => {
  const baseInput = {
    design_id: "d1",
    task_card_path: "docs/plans/active/x.txt",
    design_doc_paths: ["docs/d.md"],
    handoff_path: "docs/records/current.md",
    diff_spec: "HEAD~1..HEAD",
    changed_files: ["src/x.ts"],
    claude_output: { mode: "test" },
    tests_run: ["npm test"],
    validation_evidence: "ok",
    docs_updated: [],
  };

  it("accepts force_new_thread=true", () => {
    expect(() =>
      CodeReviewInput.parse({ ...baseInput, force_new_thread: true }),
    ).not.toThrow();
  });

  it("accepts force_new_thread=false", () => {
    expect(() =>
      CodeReviewInput.parse({ ...baseInput, force_new_thread: false }),
    ).not.toThrow();
  });

  it("accepts force_new_thread=undefined (omitted)", () => {
    expect(() => CodeReviewInput.parse(baseInput)).not.toThrow();
  });

  it("rejects non-boolean force_new_thread", () => {
    expect(() =>
      CodeReviewInput.parse({ ...baseInput, force_new_thread: "yes" }),
    ).toThrow();
    expect(() =>
      CodeReviewInput.parse({ ...baseInput, force_new_thread: 1 }),
    ).toThrow();
  });
});

describe("§8.1 #2 — FixReviewInput zod schema accepts force_new_thread", () => {
  const baseInput = {
    design_id: "d1",
    task_card_path: "docs/plans/active/x.txt",
    design_doc_paths: ["docs/d.md"],
    handoff_path: "docs/records/current.md",
    fix_diff_spec: "HEAD~1..HEAD",
    changed_files: ["src/x.ts"],
    fix_diff_lines: 10,
    docs_updated: [],
    claude_output: { mode: "test" },
    claude_fix_notes: [
      { conclusion_id: "c1", action: "fixed" as const, evidence: "x", rationale: "x" },
    ],
    previous_round_id: "rev_d1_code_1_abcd",
    previous_round_conclusions: [makeConclusion("Critical")],
    tests_run: ["npm test"],
    validation_evidence: "ok",
  };

  it("accepts force_new_thread=true", () => {
    expect(() =>
      FixReviewInput.parse({ ...baseInput, force_new_thread: true }),
    ).not.toThrow();
  });

  it("accepts force_new_thread omitted", () => {
    expect(() => FixReviewInput.parse(baseInput)).not.toThrow();
  });

  it("rejects non-boolean force_new_thread", () => {
    expect(() =>
      FixReviewInput.parse({ ...baseInput, force_new_thread: "true" }),
    ).toThrow();
  });
});

// ---------- §8.1 #8 — MCP toolSchema exposes force_new_thread ----------

describe("§8.1 #8 — MCP toolSchema.inputSchema.properties.force_new_thread exposed", () => {
  it("codeReviewToolSchema exposes force_new_thread:boolean", () => {
    const props = codeReviewToolSchema.inputSchema.properties as Record<string, { type: string }>;
    expect(props.force_new_thread).toBeDefined();
    expect(props.force_new_thread?.type).toBe("boolean");
  });

  it("fixReviewToolSchema exposes force_new_thread:boolean", () => {
    const props = fixReviewToolSchema.inputSchema.properties as Record<string, { type: string }>;
    expect(props.force_new_thread).toBeDefined();
    expect(props.force_new_thread?.type).toBe("boolean");
  });

  it("designReviewToolSchema still exposes force_new_thread:boolean (regression)", () => {
    const props = designReviewToolSchema.inputSchema.properties as Record<string, { type: string }>;
    expect(props.force_new_thread).toBeDefined();
    expect(props.force_new_thread?.type).toBe("boolean");
  });

  it("tool names are stable", () => {
    expect(codeReviewToolName).toBe("codex_code_review");
    expect(fixReviewToolName).toBe("codex_fix_review");
  });
});

// ---------- §8.1 #3-7 + §8.2 #1 — runtime semantics with mock CodexClient ----------

interface MockHandle extends ThreadHandle {
  _isResume: boolean;
  _seenInputs: string[];
}

class TrackingMockCodex implements CodexClient {
  startCalls = 0;
  resumeCalls = 0;
  threads: MockHandle[] = [];
  scriptedReplies: string[] = [];

  async startThread(): Promise<ThreadHandle> {
    this.startCalls++;
    return this._makeHandle(`thr_start_${this.startCalls}`, false);
  }

  async resumeThread(threadId: string): Promise<ThreadHandle> {
    this.resumeCalls++;
    return this._makeHandle(threadId, true);
  }

  async ping(): Promise<void> {}

  private _makeHandle(id: string, isResume: boolean): MockHandle {
    const self = this;
    const seen: string[] = [];
    const handle: MockHandle = {
      threadId: id,
      _isResume: isResume,
      _seenInputs: seen,
      async runTurn(prompt: string): Promise<RunTurnResult> {
        seen.push(prompt);
        const text = self.scriptedReplies.shift();
        if (!text) throw new Error("MockCodex out of scripted replies");
        return {
          text,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        };
      },
    };
    this.threads.push(handle);
    return handle;
  }
}

function setupTempProject(): {
  root: string;
  config: ReturnType<typeof defaultConfig>;
  cleanup: () => void;
} {
  const root = makeTempDir("codex-review-fnt-");
  mkdirSync(join(root, ".codex-review/sessions"), { recursive: true });
  mkdirSync(join(root, ".codex-review/archive"), { recursive: true });
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const name of ["design-review", "code-review", "fix-review"]) {
    writeFileSync(
      join(root, `.codex-review/templates/${name}.md.tpl`),
      `# ${name} tpl\n{{design_id}}\nprev:{{previous_round_id}}\n`,
      "utf8",
    );
  }
  writeFileSync(join(root, "docs/d.md"), "design content v1", "utf8");
  writeFileSync(join(root, "docs/task.md"), "task card", "utf8");
  writeFileSync(join(root, "docs/handoff.md"), "handoff", "utf8");
  const config = defaultConfig({
    meta: {
      project_id: "fnt-test",
      project_name: "fnt-test",
      language: "zh-CN",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  return { root, config, cleanup: () => rmDir(root) };
}

describe("§8.1 #3 — force_new_thread=true + existing state → startThread + thread_history append", () => {
  it("does not resume; appends old thread_id to thread_history with reason='force_new_thread'", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();

      // Round 1: build state with thread thr_start_1.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass-after-fixes", {
          verdict_factors: defaultFactors({ important_count: 1 }),
          conclusions: [makeConclusion("Important")],
        })),
      );
      const r1 = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "code",
          designId: "fnt-d1",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "fnt-d1" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r1.ok).toBe(true);
      expect(codex.startCalls).toBe(1);
      expect(codex.resumeCalls).toBe(0);
      const stateAfterR1 = tm.read("fnt-d1");
      expect(stateAfterR1?.thread_id).toBe("thr_start_1");
      expect(stateAfterR1?.thread_history).toEqual([]);

      // Round 2: force_new_thread=true → should startThread (new), NOT resume.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", {
          verdict_factors: defaultFactors(),
        })),
      );
      const r2 = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "code",
          designId: "fnt-d1",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "fnt-d1" },
          hasPreviousRoundResolved: false,
          forceNewThread: true,
        },
      );
      expect(r2.ok).toBe(true);
      expect(codex.startCalls).toBe(2);
      expect(codex.resumeCalls).toBe(0);
      const stateAfterR2 = tm.read("fnt-d1");
      expect(stateAfterR2?.thread_id).toBe("thr_start_2");
      expect(stateAfterR2?.thread_history.length).toBe(1);
      expect(stateAfterR2?.thread_history[0]?.thread_id).toBe("thr_start_1");
      expect(stateAfterR2?.thread_history[0]?.reason).toBe("force_new_thread");
      expect(stateAfterR2?.thread_history[0]?.abandoned_at_round.code_review).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("§8.1 #4 — force_new_thread=false + existing state → resume (regression)", () => {
  it("uses resumeThread on round 2 when force_new_thread is omitted/false", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass")),
      );
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass")),
      );
      const flowDeps = {
        config,
        configBaseDir: root,
        provider: makeCodexProvider(codex),
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState,
      };
      await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-resume",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-resume" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      });
      await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-resume",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-resume" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      });
      expect(codex.startCalls).toBe(1);
      expect(codex.resumeCalls).toBe(1);
      const state = tm.read("fnt-resume");
      expect(state?.thread_history).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("§8.1 #5 — state load without thread_history field treats as empty array", () => {
  it("zod default([]) handles legacy state files", () => {
    const { root, cleanup } = setupTempProject();
    try {
      const sessionsDir = join(root, ".codex-review/sessions");
      // Hand-write a legacy state file without thread_history field.
      const legacy = {
        design_id: "legacy",
        thread_id: "thr_legacy",
        thread_created_at: "2026-01-01T00:00:00+08:00",
        design_doc_files: {},
        rounds: { design_review: 0, code_review: 1, fix_review: 0, history: [] },
        tokens_used_estimate_total: 100,
        scope_drift_lines_total: 50,
        context_usage_pct: 0.3,
        archived: false,
        lock_holder_pid: null,
        lock_acquired_at: null,
      };
      writeFileSync(
        join(sessionsDir, "legacy.json"),
        JSON.stringify(legacy),
        "utf8",
      );
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const loaded = tm.read("legacy");
      expect(loaded?.thread_history).toEqual([]);
      expect(loaded?.scope_drift_lines_total).toBe(50);
    } finally {
      cleanup();
    }
  });
});

describe("§8.1 #6 — force_new_thread preserves rounds counters / history / drift / tokens", () => {
  it("does not reset counters or scope_drift after thread replacement", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();

      // Round 1: code_review accumulates round counter to 1.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass-after-fixes", {
          verdict_factors: defaultFactors({ important_count: 1 }),
          compact_summary_for_round: "round1 summary",
        })),
      );
      const flowDeps = {
        config,
        configBaseDir: root,
        provider: makeCodexProvider(codex),
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState,
      };
      await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-preserve",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-preserve" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      });

      // Round 2 (fix): accumulate scope_drift, build history.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("fix", "All-fixed", {
          verdict_factors: defaultFactors(),
          compact_summary_for_round: "round2 summary",
        })),
      );
      await runReviewFlow(flowDeps, {
        stage: "fix",
        designId: "fnt-preserve",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-preserve" },
        hasPreviousRoundResolved: true,
        forceNewThread: false,
        fixDiffLines: 30,
      });

      const stateBefore = tm.read("fnt-preserve");
      expect(stateBefore?.rounds.code_review).toBe(1);
      expect(stateBefore?.rounds.fix_review).toBe(1);
      expect(stateBefore?.rounds.history.length).toBe(2);
      expect(stateBefore?.scope_drift_lines_total).toBe(30);
      const tokensBefore = stateBefore?.tokens_used_estimate_total ?? 0;
      expect(tokensBefore).toBeGreaterThan(0);

      // Round 3: force_new_thread=true on code_review.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", {
          verdict_factors: defaultFactors(),
        })),
      );
      await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-preserve",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-preserve" },
        hasPreviousRoundResolved: false,
        forceNewThread: true,
      });

      const stateAfter = tm.read("fnt-preserve");
      // Counters and history MUST be preserved (not reset to zero).
      expect(stateAfter?.rounds.code_review).toBe(2); // round1 + round3
      expect(stateAfter?.rounds.fix_review).toBe(1); // unchanged from round2
      expect(stateAfter?.rounds.history.length).toBe(3);
      expect(stateAfter?.scope_drift_lines_total).toBe(30);
      expect(stateAfter?.tokens_used_estimate_total).toBeGreaterThanOrEqual(tokensBefore);
      // Thread replaced + history appended.
      expect(stateAfter?.thread_id).not.toBe(stateBefore?.thread_id);
      expect(stateAfter?.thread_history.length).toBe(1);
      expect(stateAfter?.thread_history[0]?.reason).toBe("force_new_thread");
      // Design doc files preserved.
      expect(Object.keys(stateAfter?.design_doc_files ?? {})).toContain("docs/d.md");
    } finally {
      cleanup();
    }
  });
});

describe("§8.1 #7 — force_new_thread=true + previous_round_id → startThread + previous_round_id rendered", () => {
  it("calls startThread (not resume) AND injects previous_round_id into prompt body", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();
      const flowDeps = {
        config,
        configBaseDir: root,
        provider: makeCodexProvider(codex),
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState,
      };
      // Round 1: seed state.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass-after-fixes", {
          verdict_factors: defaultFactors({ important_count: 1 }),
        })),
      );
      await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-prev",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-prev" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      });
      const startsBefore = codex.startCalls;
      const resumesBefore = codex.resumeCalls;

      // Round 2: force_new_thread=true with previous_round_id in promptVars.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );
      await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-prev",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: {
          design_id: "fnt-prev",
          previous_round_id: "rev_fnt-prev_code_1_dead",
        },
        hasPreviousRoundResolved: true,
        forceNewThread: true,
      });
      // startThread bumped, resume not bumped.
      expect(codex.startCalls).toBe(startsBefore + 1);
      expect(codex.resumeCalls).toBe(resumesBefore);
      // The most recent rendered prompt must contain previous_round_id.
      const lastHandle = codex.threads[codex.threads.length - 1] as MockHandle;
      const lastPrompt = lastHandle._seenInputs[0] ?? "";
      expect(lastPrompt).toContain("rev_fnt-prev_code_1_dead");
    } finally {
      cleanup();
    }
  });
});

describe("round breaker hydration from persisted state (round 4 RC c_round_breaker_not_hydrated_from_state)", () => {
  it("persisted state at max_code_review_rounds + fresh initialBreakerState → next call trips max_review_rounds", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const sessionsDir = join(root, ".codex-review/sessions");
      // Pre-seed a state file already at max_code_review_rounds=3.
      const seeded = {
        design_id: "seeded-at-max",
        thread_id: "thr_seeded",
        thread_created_at: "2026-01-01T00:00:00+08:00",
        design_doc_files: {},
        rounds: {
          design_review: 0,
          code_review: 3, // already at max
          fix_review: 0,
          history: [],
        },
        tokens_used_estimate_total: 0,
        scope_drift_lines_total: 0,
        thread_history: [],
        context_usage_pct: 0.1,
        archived: false,
        lock_holder_pid: null,
        lock_acquired_at: null,
      };
      writeFileSync(
        join(sessionsDir, "seeded-at-max.json"),
        JSON.stringify(seeded),
        "utf8",
      );
      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      // FRESH breakerState (rounds=0,0,0). Without hydration this would let bumpRound
      // go to 1 and not trip. With hydration it must hydrate to (0,3,0) and trip on bump.
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );
      const r = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "code",
          designId: "seeded-at-max",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "seeded-at-max" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r.ok).toBe(true);
      expect(r.breakerTripped?.name).toBe("max_review_rounds");
      // Even force_new_thread does not bypass the round breaker (regression for §6.3).
      const breakerState2 = initialBreakerState();
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );
      const r2 = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          provider: makeCodexProvider(codex),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState: breakerState2,
        },
        {
          stage: "code",
          designId: "seeded-at-max",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "seeded-at-max" },
          hasPreviousRoundResolved: false,
          forceNewThread: true,
        },
      );
      expect(r2.ok).toBe(true);
      expect(r2.breakerTripped?.name).toBe("max_review_rounds");
    } finally {
      cleanup();
    }
  });

  it("two design_ids in same process do not share rounds (cross-design isolation)", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      // ONE shared breakerState across two design_ids (mimics MCP server process).
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();
      const flowDeps = {
        config,
        configBaseDir: root,
        provider: makeCodexProvider(codex),
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState,
      };
      // Burn 3 rounds on design A.
      for (let i = 0; i < 3; i++) {
        codex.scriptedReplies.push(
          JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
        );
        const r = await runReviewFlow(flowDeps, {
          stage: "code",
          designId: "design-A",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "design-A" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        });
        expect(r.ok).toBe(true);
        expect(r.breakerTripped).toBeUndefined();
      }
      // Without hydration, breakerState.rounds.code_review would be 3 globally.
      // With hydration, calling design-B (fresh state) resets to 0, so round 1 of B
      // bumps to 1 and does NOT trip.
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );
      const rB = await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "design-B",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "design-B" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      });
      expect(rB.ok).toBe(true);
      expect(rB.breakerTripped).toBeUndefined();
      const stateB = tm.read("design-B");
      expect(stateB?.rounds.code_review).toBe(1);
      // Design A's state still records 3 (preserved on disk).
      const stateA = tm.read("design-A");
      expect(stateA?.rounds.code_review).toBe(3);
    } finally {
      cleanup();
    }
  });
});

describe("§8.2 #1 — e2e dogfood: code_review with force_new_thread=true yields different envelope.thread_id", () => {
  it("envelope.thread_id changes after force_new_thread; rounds counter does not reset", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const tm = new ThreadManager({
        sessionsDir: join(root, ".codex-review/sessions"),
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const codex = new TrackingMockCodex();
      const flowDeps = {
        config,
        configBaseDir: root,
        provider: makeCodexProvider(codex),
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState,
      };
      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass-after-fixes", {
          verdict_factors: defaultFactors({ important_count: 1 }),
        })),
      );
      const r1 = await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-e2e",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-e2e" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      });
      const tid1 = r1.envelope?.thread_id;

      codex.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );
      const r2 = await runReviewFlow(flowDeps, {
        stage: "code",
        designId: "fnt-e2e",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "fnt-e2e" },
        hasPreviousRoundResolved: false,
        forceNewThread: true,
      });
      const tid2 = r2.envelope?.thread_id;

      expect(tid1).toBeTruthy();
      expect(tid2).toBeTruthy();
      expect(tid1).not.toBe(tid2);
      // round counter persisted across thread replacement (1 + 1 = 2).
      const finalState = tm.read("fnt-e2e");
      expect(finalState?.rounds.code_review).toBe(2);
      expect(finalState?.thread_history.length).toBe(1);
    } finally {
      cleanup();
    }
  });
});
