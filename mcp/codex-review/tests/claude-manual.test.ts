// ClaudeProvider + ManualProvider tests (design §4.7 / §8.3, slice 3).
//
// Covers: ClaudeProvider adversarial system + estimated context_usage_pct + orchestrator
// override; ManualProvider two-phase (prepare->awaiting, submit->turn via the same parser),
// one-shot, and submit idempotency — all without a real API key (claude client mocked).

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ClaudeProvider, CLAUDE_ADVERSARIAL_SYSTEM } from "../src/providers/claude.js";
import { ManualProvider } from "../src/providers/manual.js";
import type { ClaudeClient, ClaudeRunInput, ClaudeRunResult } from "../src/claude-client.js";
import { runReviewFlow } from "../src/run-review-flow.js";
import { BreakerEngine, initialBreakerState } from "../src/circuit-breakers.js";
import { PromptRenderer } from "../src/prompt-renderer.js";
import { ThreadManager } from "../src/thread-manager.js";
import {
  defaultConfig,
  defaultFactors,
  makeEnvelope,
  makeTempDir,
  rmDir,
} from "./test-helpers.js";

class MockClaude implements ClaudeClient {
  seen: ClaudeRunInput[] = [];
  constructor(
    private reply: string,
    private usage = { inputTokens: 100000, outputTokens: 500 },
  ) {}
  async runTurn(input: ClaudeRunInput): Promise<ClaudeRunResult> {
    this.seen.push(input);
    return { text: this.reply, usage: this.usage };
  }
}

function setupTempProject() {
  const root = makeTempDir("ccsop-claudemanual-");
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
      project_id: "cm-test",
      project_name: "cm-test",
      language: "en",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  const sessionsDir = join(root, ".codex-review/sessions");
  const tm = new ThreadManager({
    sessionsDir,
    archiveDir: join(root, ".codex-review/archive"),
    lockTimeoutSeconds: 2,
  });
  return {
    root,
    config,
    sessionsDir,
    tm,
    renderer: new PromptRenderer(config, root),
    breakers: new BreakerEngine(config),
    cleanup: () => rmDir(root),
  };
}

// ---------- ClaudeProvider unit ----------

describe("ClaudeProvider (§4.7)", () => {
  it("openSession is fresh per turn (ignores prior — claude is stateless)", async () => {
    const provider = new ClaudeProvider(new MockClaude("x"), {
      model: "claude-opus-4-8",
      maxTokens: 1000,
      contextWindow: 200000,
    });
    const s = await provider.openSession("code", "d1", {
      provider_kind: "claude",
      external_session_id: "old",
      context_usage_source: "estimated",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(s.kind).toBe("claude");
    expect(s.externalSessionId).toBe("claude:d1:code");
  });

  it("runTurn uses the adversarial system prompt + estimates context_usage_pct", async () => {
    const mock = new MockClaude("envelope-json", { inputTokens: 100000, outputTokens: 200 });
    const provider = new ClaudeProvider(mock, {
      model: "claude-opus-4-8",
      maxTokens: 1000,
      contextWindow: 200000,
    });
    const session = await provider.openSession("code", "d1");
    const r = await provider.runTurn(
      { text: "review this", workingDirectory: "/tmp", designId: "d1", stage: "code", round: 1 },
      session,
    );
    expect(mock.seen[0]?.system).toBe(CLAUDE_ADVERSARIAL_SYSTEM);
    expect(mock.seen[0]?.userPrompt).toBe("review this");
    expect(r.kind).toBe("turn");
    if (r.kind === "turn") {
      expect(r.text).toBe("envelope-json");
      expect(r.usage.context_usage_pct).toBeCloseTo(0.5); // 100000 / 200000
      expect(r.provider_session_id).toBe("claude:d1:code");
    }
  });
});

describe("ClaudeProvider through the flow — context_usage_pct is overridden by the estimate", () => {
  it("orchestrator uses the provider estimate, not the model-emitted envelope value", async () => {
    const { root, config, tm, renderer, breakers, cleanup } = setupTempProject();
    try {
      config.review.provider = "claude";
      // Model EMITS context_usage_pct=0.05 in its envelope, but the provider estimates 0.5.
      const emitted = makeEnvelope("code", "Pass", {
        verdict_factors: defaultFactors(),
        context_usage_pct: 0.05,
      });
      const provider = new ClaudeProvider(
        new MockClaude(JSON.stringify(emitted), { inputTokens: 100000, outputTokens: 100 }),
        { model: "claude-opus-4-8", maxTokens: 1000, contextWindow: 200000 },
      );
      const r = await runReviewFlow(
        {
          config,
          configBaseDir: root,
          provider,
          threadManager: tm,
          promptRenderer: renderer,
          breakers,
          breakerState: initialBreakerState(),
        },
        {
          stage: "code",
          designId: "claude-d",
          designDocPaths: ["docs/d.md"],
          fileBlocks: [],
          promptVars: { design_id: "claude-d" },
          hasPreviousRoundResolved: false,
          forceNewThread: false,
        },
      );
      expect(r.ok).toBe(true);
      expect(r.envelope?.context_usage_pct).toBeCloseTo(0.5); // overridden, not 0.05
      const state = tm.read("claude-d");
      expect(state?.provider_kind).toBe("claude");
    } finally {
      cleanup();
    }
  });
});

// ---------- ManualProvider unit ----------

describe("ManualProvider two-phase (§4.7 C2)", () => {
  it("prepare: no verdict yet → writes prompt file + returns awaiting_manual", async () => {
    const { sessionsDir, cleanup } = setupTempProject();
    try {
      const provider = new ManualProvider({ sessionsDir });
      const session = await provider.openSession("code", "d1");
      const r = await provider.runTurn(
        { text: "PROMPT BODY", workingDirectory: "/tmp", designId: "d1", stage: "code", round: 1 },
        session,
      );
      expect(r.kind).toBe("awaiting_manual");
      if (r.kind === "awaiting_manual") {
        expect(r.prompt_path).toBe(join(sessionsDir, "d1.code.r1.prompt.md"));
        expect(r.verdict_path_expected).toBe(join(sessionsDir, "d1.code.r1.verdict.json"));
        expect(existsSync(r.prompt_path)).toBe(true);
        expect(readFileSync(r.prompt_path, "utf8")).toBe("PROMPT BODY");
      }
    } finally {
      cleanup();
    }
  });

  it("submit: verdict file present at expected path → returns kind:'turn' with its content", async () => {
    const { sessionsDir, cleanup } = setupTempProject();
    try {
      const provider = new ManualProvider({ sessionsDir });
      const session = await provider.openSession("code", "d1");
      writeFileSync(join(sessionsDir, "d1.code.r1.verdict.json"), '{"verdict":"Pass"}', "utf8");
      const r = await provider.runTurn(
        { text: "ignored", workingDirectory: "/tmp", designId: "d1", stage: "code", round: 1 },
        session,
      );
      expect(r.kind).toBe("turn");
      if (r.kind === "turn") expect(r.text).toBe('{"verdict":"Pass"}');
    } finally {
      cleanup();
    }
  });

  it("one-shot: explicit manualVerdictPath is read directly", async () => {
    const { sessionsDir, root, cleanup } = setupTempProject();
    try {
      const provider = new ManualProvider({ sessionsDir });
      const session = await provider.openSession("code", "d1");
      const vp = join(root, "external-verdict.json");
      writeFileSync(vp, '{"verdict":"No-Go"}', "utf8");
      const r = await provider.runTurn(
        {
          text: "ignored",
          workingDirectory: "/tmp",
          designId: "d1",
          stage: "code",
          round: 1,
          manualVerdictPath: vp,
        },
        session,
      );
      expect(r.kind).toBe("turn");
      if (r.kind === "turn") expect(r.text).toBe('{"verdict":"No-Go"}');
    } finally {
      cleanup();
    }
  });
});

describe("ManualProvider through the flow — prepare then submit (§8.3)", () => {
  it("prepare returns awaitingManual (no envelope, no round bump); submit parses the verdict", async () => {
    const { root, config, sessionsDir, tm, renderer, breakers, cleanup } = setupTempProject();
    try {
      config.review.provider = "manual";
      const provider = new ManualProvider({ sessionsDir });
      const deps = {
        config,
        configBaseDir: root,
        provider,
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState: initialBreakerState(),
      };
      const flowInput = {
        stage: "code" as const,
        designId: "manual-d",
        designDocPaths: ["docs/d.md"],
        fileBlocks: [],
        promptVars: { design_id: "manual-d" },
        hasPreviousRoundResolved: false,
        forceNewThread: false,
      };

      // PREPARE.
      const prep = await runReviewFlow(deps, flowInput);
      expect(prep.ok).toBe(true);
      expect(prep.awaitingManual?.prompt_path).toBe(
        join(sessionsDir, "manual-d.code.r1.prompt.md"),
      );
      expect(prep.envelope).toBeUndefined();
      // No round recorded yet (prepare does not write state).
      expect(tm.read("manual-d")).toBeNull();

      // Human pastes a verdict envelope.
      const verdict = JSON.stringify(makeEnvelope("code", "Pass", { verdict_factors: defaultFactors() }));
      const verdictPath = join(sessionsDir, "manual-d.code.r1.verdict.json");
      writeFileSync(verdictPath, verdict, "utf8");

      // SUBMIT.
      const sub = await runReviewFlow(deps, { ...flowInput, manualVerdictPath: verdictPath });
      expect(sub.ok).toBe(true);
      expect(sub.envelope?.verdict).toBe("Pass");
      expect(sub.envelope?.review_id).toMatch(/^rev_manual-d_code_1_/);
      const state = tm.read("manual-d");
      expect(state?.rounds.code_review).toBe(1);
      expect(state?.provider_kind).toBe("manual");
      const firstReviewId = sub.envelope?.review_id;

      // Idempotent resubmit (design §4.7): SAME verdict → SAME envelope (same review_id),
      // NO new round, NO history growth.
      const sub2 = await runReviewFlow(deps, { ...flowInput, manualVerdictPath: verdictPath });
      expect(sub2.envelope?.review_id).toBe(firstReviewId);
      expect(sub2.envelope?.verdict).toBe("Pass");
      const stateAfter = tm.read("manual-d");
      expect(stateAfter?.rounds.code_review).toBe(1); // not bumped to 2
      expect(stateAfter?.rounds.history.length).toBe(1);
    } finally {
      cleanup();
    }
  });
});
