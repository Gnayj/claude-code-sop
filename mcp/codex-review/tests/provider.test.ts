// Provider abstraction tests (design §4.7 / §8.3): factory selection, CodexProvider
// open/resume/run behaviour, and Q7 provider-switch session invalidation in the flow.

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createReviewProvider } from "../src/providers/factory.js";
import { CodexProvider } from "../src/providers/codex.js";
import { ClaudeProvider } from "../src/providers/claude.js";
import { ManualProvider } from "../src/providers/manual.js";
import type {
  CodexClient,
  RunTurnResult,
  StartThreadOptions,
  ThreadHandle,
} from "../src/codex-client.js";
import { runReviewFlow } from "../src/run-review-flow.js";
import { BreakerEngine, initialBreakerState } from "../src/circuit-breakers.js";
import { PromptRenderer } from "../src/prompt-renderer.js";
import { ThreadManager } from "../src/thread-manager.js";
import {
  defaultConfig,
  defaultFactors,
  makeCodexProvider,
  makeEnvelope,
  makeTempDir,
  rmDir,
} from "./test-helpers.js";

// ---------- minimal tracking mock ----------

class TrackingMockCodex implements CodexClient {
  startCalls = 0;
  resumeCalls = 0;
  lastStartOpts: StartThreadOptions | null = null;
  scriptedReplies: string[] = [];

  async startThread(opts: StartThreadOptions): Promise<ThreadHandle> {
    this.startCalls++;
    this.lastStartOpts = opts;
    return this.makeHandle(`thr_start_${this.startCalls}`);
  }
  async resumeThread(threadId: string): Promise<ThreadHandle> {
    this.resumeCalls++;
    return this.makeHandle(threadId);
  }
  async ping(): Promise<void> {}

  private makeHandle(id: string): ThreadHandle {
    const self = this;
    return {
      threadId: id,
      async runTurn(): Promise<RunTurnResult> {
        const text = self.scriptedReplies.shift();
        if (!text) throw new Error("mock out of replies");
        return { text, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
      },
    };
  }
}

// ---------- factory ----------

describe("createReviewProvider (factory, §4.7) — config-only provider selection", () => {
  const baseDeps = { workingDirectory: "/tmp/wd", sessionsDir: "/tmp/sessions" };

  it("returns a CodexProvider when review.provider=codex (default)", () => {
    const provider = createReviewProvider({
      config: defaultConfig(),
      ...baseDeps,
      codexClient: new TrackingMockCodex(),
    });
    expect(provider.kind).toBe("codex");
    expect(provider).toBeInstanceOf(CodexProvider);
  });

  it("returns a ClaudeProvider when review.provider=claude (zero code change)", () => {
    const config = defaultConfig();
    config.review.provider = "claude";
    // No claudeClient injected: AnthropicClaudeClient is constructed lazily (no key read at
    // construction), so selection succeeds without ANTHROPIC_API_KEY.
    const provider = createReviewProvider({ config, ...baseDeps });
    expect(provider.kind).toBe("claude");
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it("returns a ManualProvider when review.provider=manual (zero code change)", () => {
    const config = defaultConfig();
    config.review.provider = "manual";
    const provider = createReviewProvider({ config, ...baseDeps });
    expect(provider.kind).toBe("manual");
    expect(provider).toBeInstanceOf(ManualProvider);
  });
});

// ---------- CodexProvider open/resume/run ----------

describe("CodexProvider (raw-turn boundary, §4.7)", () => {
  it("openSession with no prior → startThread (fresh)", async () => {
    const mock = new TrackingMockCodex();
    const provider = new CodexProvider(mock, { workingDirectory: "/tmp/wd", model: "m1" });
    const session = await provider.openSession("code", "d1");
    expect(mock.startCalls).toBe(1);
    expect(mock.resumeCalls).toBe(0);
    expect(mock.lastStartOpts).toEqual({ workingDirectory: "/tmp/wd", model: "m1" });
    expect(session.externalSessionId).toBe(""); // fresh codex thread id unknown until runTurn
  });

  it("openSession with matching codex prior → resumeThread", async () => {
    const mock = new TrackingMockCodex();
    const provider = new CodexProvider(mock, { workingDirectory: "/tmp/wd" });
    const session = await provider.openSession("code", "d1", {
      provider_kind: "codex",
      external_session_id: "thr_prior",
      context_usage_source: "native",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(mock.resumeCalls).toBe(1);
    expect(mock.startCalls).toBe(0);
    expect(session.externalSessionId).toBe("thr_prior");
  });

  it("openSession with a NON-codex prior → starts fresh (no cross-provider reuse)", async () => {
    const mock = new TrackingMockCodex();
    const provider = new CodexProvider(mock, { workingDirectory: "/tmp/wd" });
    await provider.openSession("code", "d1", {
      provider_kind: "claude",
      external_session_id: "claude-history.json",
      context_usage_source: "estimated",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(mock.startCalls).toBe(1);
    expect(mock.resumeCalls).toBe(0);
  });

  it("runTurn returns kind:'turn' with provider_session_id = thread id + usage", async () => {
    const mock = new TrackingMockCodex();
    mock.scriptedReplies.push("review text");
    const provider = new CodexProvider(mock, { workingDirectory: "/tmp/wd" });
    const session = await provider.openSession("code", "d1", {
      provider_kind: "codex",
      external_session_id: "thr_x",
      context_usage_source: "native",
      created_at: "2026-01-01T00:00:00Z",
    });
    const result = await provider.runTurn(
      { text: "prompt", workingDirectory: "/tmp/wd", designId: "d1", stage: "code", round: 1 },
      session,
    );
    expect(result.kind).toBe("turn");
    if (result.kind === "turn") {
      expect(result.text).toBe("review text");
      expect(result.provider_session_id).toBe("thr_x");
      expect(result.usage.total).toBe(15);
      expect(result.usage.context_usage_pct).toBeUndefined(); // codex: orchestrator-owned
    }
  });
});

// ---------- Q7: provider-switch invalidates the persisted session ----------

function setupTempProject(): {
  root: string;
  config: ReturnType<typeof defaultConfig>;
  cleanup: () => void;
} {
  const root = makeTempDir("ccsop-provider-");
  mkdirSync(join(root, ".codex-review/sessions"), { recursive: true });
  mkdirSync(join(root, ".codex-review/archive"), { recursive: true });
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const name of ["design-review", "code-review", "fix-review"]) {
    writeFileSync(
      join(root, `.codex-review/templates/${name}.md.tpl`),
      `# ${name} tpl\n{{design_id}}\n`,
      "utf8",
    );
  }
  writeFileSync(join(root, "docs/d.md"), "design content", "utf8");
  const config = defaultConfig({
    meta: {
      project_id: "provider-test",
      project_name: "provider-test",
      language: "en",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  return { root, config, cleanup: () => rmDir(root) };
}

describe("Q7 — switching review.provider invalidates the old session", () => {
  it("a state owned by 'claude' + config provider 'codex' → fresh codex session, reason=provider_switch", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const sessionsDir = join(root, ".codex-review/sessions");
      // Seed a state that was produced by the claude provider.
      const seeded = {
        design_id: "switch-d",
        thread_id: "claude-history-handle",
        thread_created_at: "2026-01-01T00:00:00Z",
        provider_kind: "claude",
        design_doc_files: {},
        rounds: { design_review: 0, code_review: 1, fix_review: 0, history: [] },
        tokens_used_estimate_total: 100,
        scope_drift_lines_total: 0,
        thread_history: [],
        context_usage_pct: 0.1,
        archived: false,
        lock_holder_pid: null,
        lock_acquired_at: null,
      };
      writeFileSync(join(sessionsDir, "switch-d.json"), JSON.stringify(seeded), "utf8");

      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const mock = new TrackingMockCodex();
      mock.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );

      const r = await runReviewFlow(
        {
          config, // config.review.provider defaults to "codex"
          configBaseDir: root,
          providerFor: () => makeCodexProvider(mock, root),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "code",
          designId: "switch-d",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "switch-d" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );

      expect(r.ok).toBe(true);
      // The codex provider must START a fresh thread (NOT resume the claude handle).
      expect(mock.startCalls).toBe(1);
      expect(mock.resumeCalls).toBe(0);

      const state = tm.read("switch-d");
      // provider_kind flips to codex; old claude session archived in thread_history with the switch reason.
      expect(state?.provider_kind).toBe("codex");
      expect(state?.thread_history.length).toBe(1);
      expect(state?.thread_history[0]?.thread_id).toBe("claude-history-handle");
      expect(state?.thread_history[0]?.reason).toBe("provider_switch");
      // Round counter preserved across the switch (1 + this round = 2).
      expect(state?.rounds.code_review).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("legacy state without provider_kind loads as codex and resumes (no spurious switch)", async () => {
    const { root, config, cleanup } = setupTempProject();
    try {
      const sessionsDir = join(root, ".codex-review/sessions");
      // Legacy pre-abstraction state: no provider_kind field.
      const legacy = {
        design_id: "legacy-d",
        thread_id: "thr_legacy",
        thread_created_at: "2026-01-01T00:00:00Z",
        design_doc_files: {},
        rounds: { design_review: 0, code_review: 1, fix_review: 0, history: [] },
        tokens_used_estimate_total: 0,
        scope_drift_lines_total: 0,
        thread_history: [],
        context_usage_pct: 0.1,
        archived: false,
        lock_holder_pid: null,
        lock_acquired_at: null,
      };
      writeFileSync(join(sessionsDir, "legacy-d.json"), JSON.stringify(legacy), "utf8");

      const tm = new ThreadManager({
        sessionsDir,
        archiveDir: join(root, ".codex-review/archive"),
        lockTimeoutSeconds: 2,
      });
      // Loaded state defaults provider_kind to "codex".
      expect(tm.read("legacy-d")?.provider_kind).toBe("codex");

      const renderer = new PromptRenderer(config, root);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      const mock = new TrackingMockCodex();
      mock.scriptedReplies.push(
        JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() })),
      );

      await runReviewFlow(
        {
          config,
          configBaseDir: root,
          providerFor: () => makeCodexProvider(mock, root),
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState,
        },
        {
          stage: "code",
          designId: "legacy-d",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "legacy-d" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );

      // codex prior matches codex provider → resume, no switch.
      expect(mock.resumeCalls).toBe(1);
      expect(mock.startCalls).toBe(0);
      expect(tm.read("legacy-d")?.thread_history).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
