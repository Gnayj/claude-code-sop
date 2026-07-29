import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  claudeApiOnlyKeyWarnings,
  ClaudeEffortSchema,
  ConfigSchema,
  EffortSchema,
} from "../src/config.js";
import {
  ClaudeCliClient,
  ClaudeCliInvocationError,
  ClaudeCliQuotaError,
  ClaudeCliResumeInvalidError,
  NoClaudeCliBinaryError,
  parseClaudeCliResult,
  type ClaudeCliDeps,
  type ClaudeCliRunInput,
  type ClaudeCliRunResult,
} from "../src/claude-cli-client.js";
import type { ClaudeClient, ClaudeRunInput } from "../src/claude-client.js";
import { ClaudeProvider, type ClaudeCliRunner } from "../src/providers/claude.js";
import { ThreadManager } from "../src/thread-manager.js";
import { defaultConfig, makeTempDir, rmDir } from "./test-helpers.js";

describe("Claude backend config contracts", () => {
  it("keeps Claude and Codex effort domains distinct", () => {
    expect(ClaudeEffortSchema.safeParse("max").success).toBe(true);
    expect(ClaudeEffortSchema.safeParse("minimal").success).toBe(false);
    expect(EffortSchema.safeParse("minimal").success).toBe(true);
    expect(EffortSchema.safeParse("max").success).toBe(false);
  });

  it("defaults new Claude backend keys for existing configs", () => {
    const base = defaultConfig();
    const parsed = ConfigSchema.parse({
      ...base,
      review: {
        ...base.review,
        claude: {
          model: "",
          max_tokens: 16000,
          key_env: "ANTHROPIC_API_KEY",
          context_window: 200000,
        },
      },
    });

    expect(parsed.review.claude).toMatchObject({
      backend: "api",
      effort: "",
      cli_path: "",
    });
  });

  it("warns once for each API-only key explicitly configured with the CLI backend", () => {
    const config = defaultConfig();
    config.review.claude.backend = "cli";
    const warnings = claudeApiOnlyKeyWarnings(config, {
      review: {
        claude: {
          backend: "cli",
          max_tokens: 12000,
          key_env: "ANTHROPIC_API_KEY",
          context_window: 180000,
        },
      },
    });

    expect(warnings).toHaveLength(3);
    for (const key of ["max_tokens", "key_env", "context_window"]) {
      expect(warnings.filter((warning) => warning.includes(`.${key} `))).toHaveLength(1);
    }
  });

  it("does not warn for API-only defaults absent from raw TOML", () => {
    const raw = defaultConfig() as any;
    raw.review.claude.backend = "cli";
    delete raw.review.claude.max_tokens;
    delete raw.review.claude.key_env;
    delete raw.review.claude.context_window;
    const config = ConfigSchema.parse(raw);

    expect(config.review.claude).toMatchObject({
      max_tokens: 16000,
      key_env: "ANTHROPIC_API_KEY",
      context_window: 200000,
    });
    expect(claudeApiOnlyKeyWarnings(config, raw)).toEqual([]);
  });

  it("does not warn for explicit API-only keys with the API backend", () => {
    const config = defaultConfig();
    expect(claudeApiOnlyKeyWarnings(config, defaultConfig())).toEqual([]);
  });
});

function cliHarness(response: object) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let stdin = "";
  child.stdin.on("data", (chunk) => { stdin += String(chunk); });
  const calls: Array<{ binary: string; args: readonly string[]; cwd: string }> = [];
  const deps: ClaudeCliDeps = {
    findOnPath: () => "/usr/bin/claude",
    smokeProbe: () => ({ ok: true, output: "Claude Code 1.2.3" }),
    spawn: ((binary: string, args: readonly string[], options: { cwd: string }) => {
      calls.push({ binary, args, cwd: options.cwd });
      queueMicrotask(() => {
        child.stdout.end(JSON.stringify(response));
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return child;
    }) as ClaudeCliDeps["spawn"],
  };
  return {
    client: new ClaudeCliClient({}, deps),
    calls,
    stdin: () => stdin,
  };
}

const success = {
  type: "result", is_error: false, result: "review text", session_id: "session-new",
  modelUsage: {
    "claude-opus-4-8": {
      inputTokens: 10, outputTokens: 4,
      cacheReadInputTokens: 20, cacheCreationInputTokens: 30,
      contextWindow: 200000,
    },
  },
};

describe("Claude CLI argv and JSON contract", () => {
  it.each([
    {
      label: "minimal",
      extra: {},
      expected: [
        "-p", "--output-format", "json", "--model", "claude-opus-4-8",
        "--system-prompt", "SYSTEM", "--safe-mode", "--tools", ""],
    },
    {
      label: "effort",
      extra: { effort: "max" as const },
      expected: [
        "-p", "--output-format", "json", "--model", "claude-opus-4-8",
        "--effort", "max", "--system-prompt", "SYSTEM", "--safe-mode", "--tools", ""],
    },
    {
      label: "resume",
      extra: { resumeSessionId: "session-old" },
      expected: [
        "-p", "--output-format", "json", "--model", "claude-opus-4-8",
        "--system-prompt", "SYSTEM", "--safe-mode", "--tools", "", "--resume", "session-old"],
    },
  ])("spawns exact $label argv and writes the prompt only to stdin", async ({ extra, expected }) => {
    const harness = cliHarness(success);
    const input: ClaudeCliRunInput = {
      system: "SYSTEM",
      model: "claude-opus-4-8",
      userPrompt: "PROMPT_TOO_LARGE_FOR_ARGV",
      workingDirectory: "/repo/worktree",
      ...extra,
    };

    const result = await harness.client.runTurn(input);

    expect(harness.calls).toEqual([{
      binary: "/usr/bin/claude",
      args: expected,
      cwd: input.workingDirectory,
    }]);
    // Assert the invariants against what was actually spawned, not against `expected` — otherwise
    // editing `expected` alone could silently satisfy them.
    const args = harness.calls[0]!.args;
    expect(args).not.toContain("--bare");
    expect(args).not.toContain(input.userPrompt);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(harness.stdin()).toBe(input.userPrompt);
    expect(result).toMatchObject({ text: "review text", sessionId: "session-new" });
  });

  it("parses is_error details into a readable typed failure", async () => {
    const harness = cliHarness({
      type: "result",
      is_error: true,
      result: "request failed",
      session_id: "session-old",
      api_error_status: 500,
      terminal_reason: "upstream_error",
    });

    await expect(harness.client.runTurn({
      system: "SYSTEM",
      model: "claude-opus-4-8",
      userPrompt: "review",
      workingDirectory: "/repo/worktree",
    })).rejects.toMatchObject({
      name: "ClaudeCliInvocationError",
      message: expect.stringMatching(
        /api_error_status=500.*terminal_reason=upstream_error/,
      ),
    });
  });

  it.each([
    { api_error_status: "rate_limit_error", result: "request rejected" },
    { terminal_reason: "usage_limit", result: "You've hit your weekly usage limit" },
  ])("recognizes quota diagnostics without status 429", async (diagnostic) => {
    const harness = cliHarness({
      type: "result",
      is_error: true,
      session_id: "session-old",
      ...diagnostic,
    });

    await expect(harness.client.runTurn({
      system: "SYSTEM",
      model: "claude-opus-4-8",
      userPrompt: "review",
      workingDirectory: "/repo/worktree",
    })).rejects.toBeInstanceOf(ClaudeCliQuotaError);
  });

  it("classifies an empty-stdout resume diagnostic from stderr", () => {
    const diagnostic = "No conversation found with session ID: xxx";
    const parse = () => parseClaudeCliResult(
      "",
      { model: "claude-opus-4-8", resumeSessionId: "xxx" },
      diagnostic,
      1,
    );

    expect(parse).toThrowError(ClaudeCliResumeInvalidError);
    expect(parse).toThrow(/stderr=No conversation found with session ID: xxx/);
  });

  it("keeps an empty-stdout diagnostic non-retriable without a resume request", () => {
    expect(() => parseClaudeCliResult(
      "",
      { model: "claude-opus-4-8" },
      "No conversation found with session ID: xxx",
      1,
    )).toThrowError(ClaudeCliInvocationError);
  });
});

class ScriptedCli implements ClaudeCliRunner {
  readonly resolution = { binaryPath: "/test/claude", source: "config" as const };
  readonly seen: ClaudeCliRunInput[] = [];
  constructor(private readonly replies: Array<ClaudeCliRunResult | Error>) {}
  async runTurn(input: ClaudeCliRunInput): Promise<ClaudeCliRunResult> {
    this.seen.push(input);
    const reply = this.replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error("mock out of replies");
    return reply;
  }
}

class TrackingApi implements ClaudeClient {
  readonly seen: ClaudeRunInput[] = [];
  async runTurn(input: ClaudeRunInput) {
    this.seen.push(input);
    return { text: "api text", usage: { inputTokens: 20, outputTokens: 5 } };
  }
}

function cliResult(over: Partial<ClaudeCliRunResult> = {}): ClaudeCliRunResult {
  return {
    text: "cli text",
    sessionId: "session-new",
    usage: { inputTokens: 600, outputTokens: 10 },
    contextWindow: 1000,
    warnings: [],
    ...over,
  };
}

function cliProvider(cli: ClaudeCliRunner, api = new TrackingApi()) {
  return {
    provider: new ClaudeProvider(api, {
      backend: "cli",
      model: "claude-opus-4-8",
      maxTokens: 16000,
      contextWindow: 2000,
      effort: "max",
      cliClient: cli,
      keyEnv: "CCSOP_TEST_CLAUDE_KEY",
    }),
    api,
  };
}

const turnInput = {
  text: "review", workingDirectory: "/tmp", designId: "d1", stage: "code" as const, round: 1,
};
const prior = (id: string) => ({
  provider_kind: "claude" as const,
  external_session_id: id,
  context_usage_source: "estimated" as const,
  created_at: "2026-01-01T00:00:00Z",
});

describe("ClaudeProvider CLI runtime policy", () => {
  it("reloads the provider_resume_invalidated history reason", () => {
    const root = makeTempDir("ccsop-claude-history-");
    try {
      const manager = new ThreadManager({
        sessionsDir: root,
        archiveDir: `${root}/archive`,
        lockTimeoutSeconds: 1,
      });
      const state = manager.newState("d1", "session-new", "claude");
      state.thread_history.push({
        thread_id: "session-old",
        abandoned_at_round: { design_review: 0, code_review: 1, fix_review: 0 },
        abandoned_at: "2026-01-01T00:00:00Z",
        reason: "provider_resume_invalidated",
      });
      manager.write(state);
      expect(manager.read("d1")?.thread_history[0]?.reason)
        .toBe("provider_resume_invalidated");
    } finally {
      rmDir(root);
    }
  });

  it("retries an invalid resume fresh once and surfaces the new session", async () => {
    const cli = new ScriptedCli([
      new ClaudeCliResumeInvalidError("session expired"),
      cliResult(),
    ]);
    const { provider } = cliProvider(cli);
    const session = await provider.openSession("code", "d1", prior("session-old"));
    const result = await provider.runTurn(turnInput, session);

    expect(cli.seen.map((call) => call.resumeSessionId)).toEqual(["session-old", undefined]);
    expect(cli.seen.map((call) => call.workingDirectory)).toEqual(["/tmp", "/tmp"]);
    expect(result).toMatchObject({
      kind: "turn", provider_session_id: "session-new",
      warnings: [expect.stringMatching(/old_session_id=session-old.*session expired/)],
      session_rotation: {
        previous_session_id: "session-old",
        reason: "provider_resume_invalidated",
      },
    });
  });

  it("falls back on quota only when the configured API key is available", async () => {
    const key = "CCSOP_TEST_CLAUDE_KEY";
    const previous = process.env[key];
    try {
      process.env[key] = "available";
      const cli = new ScriptedCli([new ClaudeCliQuotaError("limit reached", 429)]);
      const { provider, api } = cliProvider(cli);
      const result = await provider.runTurn(
        turnInput,
        await provider.openSession("code", "d1", prior("session-old")),
      );
      expect(api.seen).toHaveLength(1);
      expect(result).toMatchObject({
        kind: "turn",
        warnings: [expect.stringMatching(/backend=cli.*backend=api.*model=claude-opus-4-8/)],
        session_rotation: {
          previous_session_id: "session-old",
          reason: "provider_backend_fallback",
        },
      });
      expect(JSON.stringify(result)).not.toContain("resume invalidated");

      const firstTurn = cliProvider(
        new ScriptedCli([new ClaudeCliQuotaError("weekly limit reached", undefined)]),
      ).provider;
      await expect(firstTurn.runTurn(
        turnInput,
        await firstTurn.openSession("code", "d1"),
      )).resolves.toMatchObject({
        session_rotation: {
          previous_session_id: "",
          reason: "provider_backend_fallback",
        },
      });

      delete process.env[key];
      const blockedApi = new TrackingApi();
      const blocked = cliProvider(
        new ScriptedCli([new ClaudeCliQuotaError("quota exhausted", 429)]),
        blockedApi,
      ).provider;
      await expect(blocked.runTurn(
        turnInput,
        await blocked.openSession("code", "d1"),
      )).rejects.toThrow("quota exhausted");
      expect(blockedApi.seen).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("does not fall back when CLI startup fails", async () => {
    const api = new TrackingApi();
    const { provider } = cliProvider(new ScriptedCli([
      new NoClaudeCliBinaryError("not set", "not found"),
    ]), api);
    await expect(provider.runTurn(
      turnInput,
      await provider.openSession("code", "d1"),
    )).rejects.toBeInstanceOf(NoClaudeCliBinaryError);
    expect(api.seen).toHaveLength(0);
  });

  it("uses reported context, falls back with warnings, and skips synthetic API ids", async () => {
    const cli = new ScriptedCli([
      cliResult(),
      cliResult({ sessionId: "session-next", contextWindow: undefined,
        warnings: ["Claude CLI did not report contextWindow; using configured fallback"] }),
    ]);
    const { provider } = cliProvider(cli);
    const synthetic = await provider.openSession("code", "d1", prior("claude:d1:code"));
    const reported = await provider.runTurn(turnInput, synthetic);
    const fallback = await provider.runTurn(
      turnInput,
      await provider.openSession("code", "d1"),
    );

    expect(cli.seen[0]).not.toHaveProperty("resumeSessionId");
    expect(reported).toMatchObject({
      usage: { input: 600, output: 10, total: 610, context_usage_pct: 0.6 },
      warnings: [expect.stringContaining("old_session_id=claude:d1:code")],
      session_rotation: {
        previous_session_id: "claude:d1:code",
        reason: "provider_resume_invalidated",
      },
    });
    expect(fallback).toMatchObject({
      usage: { context_usage_pct: 0.3 },
      warnings: [expect.stringContaining("configured fallback")],
    });
  });
});
