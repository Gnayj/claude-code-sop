import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BreakerEngine, initialBreakerState } from "../src/circuit-breakers.js";
import { provideDiff } from "../src/diff-provision.js";
import { PromptRenderer } from "../src/prompt-renderer.js";
import type {
  PersistedProviderSession,
  ProviderRunResult,
  ProviderSession,
  RenderedReviewPrompt,
  ReviewProvider,
} from "../src/review-provider.js";
import { runReviewFlow } from "../src/run-review-flow.js";
import { ThreadManager } from "../src/thread-manager.js";
import type { ProviderKind, ReviewStage } from "../src/types.js";
import {
  defaultConfig,
  defaultFactors,
  makeEnvelope,
  makeTempDir,
  rmDir,
} from "./test-helpers.js";

vi.mock("../src/diff-provision.js", () => ({
  provideDiff: vi.fn(),
  errorDetail: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

type Turn = Extract<ProviderRunResult, { kind: "turn" }>;

class CliClaudeStub implements ReviewProvider {
  readonly prompts: RenderedReviewPrompt[] = [];
  openSessionCount = 0;

  constructor(
    private readonly result: Turn,
    readonly kind: ProviderKind = "claude",
    // Mirrors production: claude is the only tool-less reviewer kind.
    readonly can_read_repo = kind !== "claude",
  ) {}

  async openSession(
    stage: ReviewStage,
    designId: string,
    prior?: PersistedProviderSession,
  ): Promise<ProviderSession> {
    this.openSessionCount++;
    return {
      kind: this.kind,
      designId,
      stage,
      externalSessionId: prior?.external_session_id ?? "",
    };
  }

  async runTurn(
    input: RenderedReviewPrompt,
    _session: ProviderSession,
  ): Promise<ProviderRunResult> {
    this.prompts.push(input);
    return this.result;
  }

  closeSession(_session: ProviderSession): void {}
}

function turn(over: Partial<Turn> = {}, stage: ReviewStage = "code"): Turn {
  const verdict =
    stage === "design" ? "Go" : stage === "code" ? "Pass" : "All-fixed";
  return {
    kind: "turn",
    text: JSON.stringify(makeEnvelope(stage, verdict, {
      verdict_factors: defaultFactors(),
    })),
    usage: { input: 10, output: 5, total: 15, context_usage_pct: 0.1 },
    provider_session_id: "session-new",
    ...over,
  };
}

interface SetupOptions {
  stage?: ReviewStage;
  providerKind?: ProviderKind;
  diffSpec?: string;
  changedFiles?: string[];
}

function setup(result: Turn, options: SetupOptions = {}) {
  const stage = options.stage ?? "code";
  const providerKind = options.providerKind ?? "claude";
  const root = makeTempDir("ccsop-claude-cli-flow-");
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const templateStage of ["design", "code", "fix"] as const) {
    writeFileSync(
      join(root, `.codex-review/templates/${templateStage}-review.md.tpl`),
      `# ${templateStage} review\n{{design_id}}\n`,
      "utf8",
    );
  }
  writeFileSync(join(root, "docs/design.md"), "design", "utf8");
  const config = defaultConfig();
  config.review.provider = providerKind;
  config.review.max_injected_diff_bytes = 262144;
  const threadManager = new ThreadManager({
    sessionsDir: join(root, ".codex-review/sessions"),
    archiveDir: join(root, ".codex-review/archive"),
    lockTimeoutSeconds: 1,
  });
  const provider = new CliClaudeStub(result, providerKind);
  const breakerState = initialBreakerState();
  return {
    provider,
    breakerState,
    threadManager,
    run: () => runReviewFlow(
      {
        config,
        configBaseDir: root,
        providerFor: () => provider,
        threadManager,
        promptRenderer: new PromptRenderer(config, root),
        breakers: new BreakerEngine(config),
        breakerState,
      },
      {
        stage,
        designId: "claude-cli-flow",
        designDocPaths: ["docs/design.md"],
        fileBlocks: [],
        diffSpec: options.diffSpec,
        changedFiles: options.changedFiles,
        promptVars: { design_id: "claude-cli-flow" },
        hasPreviousRoundResolved: stage === "fix",
        forceNewThread: false,
      },
    ),
    cleanup: () => rmDir(root),
  };
}

const provideDiffMock = vi.mocked(provideDiff);

beforeEach(() => {
  provideDiffMock.mockReset();
  provideDiffMock.mockReturnValue({
    block: "## [bridge-provided] Git diff\n\n```diff\n+bridge change\n```",
    warnings: [],
  });
});

describe("runReviewFlow Claude CLI runtime audit signals", () => {
  it("surfaces provider warnings in the tool result", async () => {
    const fixture = setup(turn({ warnings: ["provider runtime warning"] }), {
      diffSpec: "HEAD~1",
    });
    try {
      const result = await fixture.run();
      expect(result.warnings).toContain("provider runtime warning");
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    ["resume invalidation", "provider_resume_invalidated" as const],
    ["backend fallback with a prior session", "provider_backend_fallback" as const],
  ])("persists %s and rotates the active thread id", async (_label, reason) => {
    const fixture = setup(
      turn({
        warnings: ["provider rotated the session"],
        session_rotation: {
          previous_session_id: "session-old",
          reason,
        },
      }),
      { diffSpec: "HEAD~1" },
    );
    try {
      fixture.threadManager.write(
        fixture.threadManager.newState("claude-cli-flow", "session-old", "claude"),
      );
      await fixture.run();

      const state = fixture.threadManager.read("claude-cli-flow");
      expect(state?.thread_id).toBe("session-new");
      expect(state?.thread_history).toMatchObject([{
        thread_id: "session-old",
        reason,
      }]);
    } finally {
      fixture.cleanup();
    }
  });

  it("persists a first-turn backend fallback even without a prior session", async () => {
    const fixture = setup(
      turn({
        provider_session_id: "claude:claude-cli-flow:code",
        warnings: ["CLI quota exhausted; fell back to API"],
        session_rotation: {
          previous_session_id: "",
          reason: "provider_backend_fallback",
        },
      }),
      { diffSpec: "HEAD~1" },
    );
    try {
      await fixture.run();

      const state = fixture.threadManager.read("claude-cli-flow");
      expect(state?.thread_id).toBe("claude:claude-cli-flow:code");
      expect(state?.thread_history).toMatchObject([{
        thread_id: "",
        reason: "provider_backend_fallback",
      }]);
    } finally {
      fixture.cleanup();
    }
  });
});

describe("runReviewFlow bridge prompt assembly", () => {
  it.each([
    ["design", "codex"],
    ["design", "claude"],
    ["code", "codex"],
    ["code", "claude"],
    ["fix", "codex"],
    ["fix", "claude"],
  ] as const)(
    "injects the authoritative contract for stage=%s provider=%s",
    async (stage, providerKind) => {
      const fixture = setup(turn({}, stage), {
        stage,
        providerKind,
        diffSpec: "main...HEAD",
      });
      try {
        const result = await fixture.run();
        expect(result.ok).toBe(true);
        expect(fixture.provider.prompts).toHaveLength(1);
        expect(fixture.provider.prompts[0]?.text).toContain(
          `## [bridge-authoritative] Envelope contract (stage=${stage})`,
        );
      } finally {
        fixture.cleanup();
      }
    },
  );

  it.each([
    ["design", "claude", false],
    ["code", "claude", true],
    ["fix", "claude", true],
    ["code", "codex", false],
    ["fix", "codex", false],
  ] as const)(
    "injects diff only when stage=%s provider=%s expects=%s",
    async (stage, providerKind, expectsDiff) => {
      const fixture = setup(turn({}, stage), {
        stage,
        providerKind,
        diffSpec: "main...HEAD",
        changedFiles: ["src/change.ts"],
      });
      try {
        const result = await fixture.run();
        expect(result.ok).toBe(true);
        const prompt = fixture.provider.prompts[0]?.text ?? "";
        expect(prompt.includes("[bridge-provided] Git diff")).toBe(expectsDiff);
        expect(provideDiffMock).toHaveBeenCalledTimes(expectsDiff ? 1 : 0);
      } finally {
        fixture.cleanup();
      }
    },
  );

  it("returns diff warnings with the successful Claude flow result", async () => {
    provideDiffMock.mockReturnValueOnce({
      block: "## [bridge-provided] Git diff",
      warnings: ["changed_files omitted src/extra.ts"],
    });
    const fixture = setup(turn(), {
      diffSpec: "HEAD~1",
      changedFiles: ["src/change.ts"],
    });
    try {
      const result = await fixture.run();
      expect(result.ok).toBe(true);
      expect(result.warnings).toContain("changed_files omitted src/extra.ts");
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed before opening a tool-less code review without diff_spec", async () => {
    const fixture = setup(turn(), {
      stage: "code",
      providerKind: "claude",
    });
    const breakerBefore = structuredClone(fixture.breakerState);
    try {
      const result = await fixture.run();
      expect(result.ok).toBe(false);
      expect(result.bridgePrecondition).toEqual({
        reason: "diff_spec_required",
        detail: expect.stringContaining("diff_spec"),
      });
      expect(result.parseResult).toBeUndefined();
      expect(result.warnings.join("\n")).toContain("diff_spec");
      expect(fixture.provider.openSessionCount).toBe(0);
      expect(fixture.provider.prompts).toHaveLength(0);
      expect(fixture.breakerState).toEqual(breakerBefore);
      expect(fixture.threadManager.read("claude-cli-flow")).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it("fails before a provider turn without changing rounds or breaker state", async () => {
    provideDiffMock.mockImplementationOnce(() => {
      throw new Error("changed file is untracked");
    });
    const fixture = setup(turn(), {
      diffSpec: "HEAD~1",
      changedFiles: ["src/untracked.ts"],
    });
    const breakerBefore = structuredClone(fixture.breakerState);
    try {
      const result = await fixture.run();
      expect(result.ok).toBe(false);
      expect(result.bridgePrecondition).toEqual({
        reason: "diff_provision_failed",
        detail: expect.stringContaining("changed file is untracked"),
      });
      expect(result.parseResult).toBeUndefined();
      expect(result.breakerTripped).toBeUndefined();
      expect(result.warnings.join("\n")).toContain("changed file is untracked");
      expect(fixture.provider.openSessionCount).toBe(0);
      expect(fixture.provider.prompts).toHaveLength(0);
      expect(fixture.breakerState).toEqual(breakerBefore);
      expect(fixture.threadManager.read("claude-cli-flow")).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });
});
