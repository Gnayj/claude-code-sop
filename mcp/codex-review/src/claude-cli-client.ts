// Claude CLI subprocess client for the `backend = "cli"` review path (design
// ccsop-claude-cli-backend §4.2/§4.4). Runs `claude -p` against the user's logged-in
// subscription instead of the credit-billed Anthropic API.
//
// This layer only invokes and parses: it classifies failures into typed errors and never
// retries or falls back. Retry-on-resume-failure and the quota fallback to the API backend are
// provider-level decisions (design §4.3/§4.7) and live in providers/claude.ts.
//
// Like codex-client, every process/filesystem touchpoint is injectable so tests can drive the
// full argv + parsing contract without spawning anything.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

import { findExecutableOnPath } from "./codex-resolve.js";
import type { ClaudeEffort } from "./config.js";

export type ClaudeCliBinarySource = "config" | "path";

export interface ClaudeCliResolution {
  binaryPath: string;
  source: ClaudeCliBinarySource;
  /** Probe output is provenance only; it is never interpreted as a compatibility version. */
  probeOutput?: string;
}

/** Injectable seams so the chain + invocation are unit-testable without a real process. */
export interface ClaudeCliDeps {
  findOnPath(binaryName: string): string | undefined;
  smokeProbe(binaryPath: string): { ok: boolean; output?: string };
  spawn(binaryPath: string, args: readonly string[], options: {
    stdio: ["pipe", "pipe", "pipe"];
    windowsHide: boolean;
    cwd: string;
  }): ChildProcessWithoutNullStreams;
}

export class NoClaudeCliBinaryError extends Error {
  constructor(configAttempt: string, pathAttempt: string) {
    super(
      "ccsop review bridge: no usable Claude CLI binary found. Resolution attempts:\n" +
        `  1. [review.claude] cli_path: ${configAttempt}\n` +
        `  2. PATH claude: ${pathAttempt}\n` +
        "Set `[review.claude] cli_path` to a working Claude CLI binary, or put `claude` on PATH " +
        "and log in.",
    );
    this.name = "NoClaudeCliBinaryError";
  }
}
/** Spawn / exit / JSON-parse failure. The caller must NOT auto-fall-back on this (design §4.7). */
export class ClaudeCliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCliInvocationError";
  }
}

/** The resumed session is gone (expired / GC'd / unknown id) — provider retries once fresh. */
export class ClaudeCliResumeInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCliResumeInvalidError";
  }
}

/** 429 / quota exhausted — a first-class state under a subscription (design §2.1 constraint 2). */
export class ClaudeCliQuotaError extends Error {
  constructor(message: string, readonly apiErrorStatus: unknown) {
    super(message);
    this.name = "ClaudeCliQuotaError";
  }
}

/** Liveness-only probe: does the binary launch and exit cleanly? It neither establishes flag
 * compatibility nor detects login state. A missing login is exposed as a readable error by the
 * first real invocation; probing it here would consume subscription quota on every bridge start.
 * The output is captured only for provenance (design §4.7). */
function defaultSmokeProbe(binaryPath: string): { ok: boolean; output?: string } {
  try {
    const result = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return { ok: false };
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return { ok: true, ...(output ? { output: truncate(output) } : {}) };
  } catch {
    return { ok: false };
  }
}

const defaultDeps: ClaudeCliDeps = {
  findOnPath: findExecutableOnPath,
  smokeProbe: defaultSmokeProbe,
  spawn: (binaryPath, args, options) =>
    spawn(binaryPath, args, options) as ChildProcessWithoutNullStreams,
};

const resolutionCache = new Map<string, ClaudeCliResolution>();
export function resolveClaudeCliBinary(
  opts: { cliPath?: string },
  deps: Pick<ClaudeCliDeps, "findOnPath" | "smokeProbe"> = defaultDeps,
): ClaudeCliResolution {
  const configured = (opts.cliPath ?? "").trim();
  if (configured) {
    const probe = deps.smokeProbe(configured);
    if (!probe.ok) {
      throw new NoClaudeCliBinaryError(
        `${configured} failed the liveness probe`,
        "not attempted because cli_path has precedence",
      );
    }
    return {
      binaryPath: configured,
      source: "config",
      ...(probe.output ? { probeOutput: probe.output } : {}),
    };
  }

  // Link 2 — `claude` on PATH. There is deliberately NO package fallback link (unlike the codex
  // chain): on a machine choosing backend="cli" the CLI itself is the install path.
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const onPath = deps.findOnPath(binaryName);
  if (!onPath) {
    throw new NoClaudeCliBinaryError("not set", `${binaryName} was not found`);
  }
  const probe = deps.smokeProbe(onPath);
  if (!probe.ok) {
    throw new NoClaudeCliBinaryError("not set", `${onPath} failed the liveness probe`);
  }
  return {
    binaryPath: onPath,
    source: "path",
    ...(probe.output ? { probeOutput: probe.output } : {}),
  };
}

/** Memoized per cli_path, mirroring codex-client: the chain shells out, so it runs once per
 * process. Injected (test) deps bypass the cache so each case resolves independently. */
function resolveClaudeCliOnce(opts: { cliPath?: string }, deps: ClaudeCliDeps): ClaudeCliResolution {
  if (deps !== defaultDeps) return resolveClaudeCliBinary(opts, deps);
  const key = (opts.cliPath ?? "").trim();
  const cached = resolutionCache.get(key);
  if (cached) return cached;
  const resolution = resolveClaudeCliBinary(opts, deps);
  resolutionCache.set(key, resolution);
  return resolution;
}

export interface ClaudeCliRunInput {
  system: string;
  model: string;
  effort?: ClaudeEffort | "";
  userPrompt: string;
  workingDirectory: string;
  resumeSessionId?: string;
}

export interface ClaudeCliRunResult {
  text: string;
  sessionId: string;
  usage: { inputTokens: number; outputTokens: number };
  contextWindow?: number;
  warnings: string[];
  /**
   * Subscription-equivalent accounting only. Review callers must not treat this as billed
   * spend; the implement adapter may use it solely against its explicitly equivalent-value
   * CLI budget/ledger ceiling.
   */
  totalCostUsd?: number;
  permissionDenials?: unknown[];
}

/** The exact CLI contract (design §4.2). `--safe-mode` + an empty `--tools` set is the isolation
 * pair: it blocks hooks/plugins/MCP (no recursive self-invocation of this bridge) and disables the
 * built-in tools wholesale, which is fail-closed against future tool additions and matches the API
 * backend's "pure prompt, zero tools" review semantics.
 *
 * `--bare` is BANNED: its auth is strictly ANTHROPIC_API_KEY/apiKeyHelper with OAuth and keychain
 * never read, which would cancel out this whole backend (design §2.1 constraint 1). */
export function buildClaudeCliArgs(input: ClaudeCliRunInput): string[] {
  const args = ["-p", "--output-format", "json", "--model", input.model];
  if (input.effort) args.push("--effort", input.effort);
  args.push("--system-prompt", input.system, "--safe-mode", "--tools", "");
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  return args;
}

export interface ClaudeImplementCliArgsInput {
  model: string;
  effort?: ClaudeEffort | "";
  systemPrompt: string;
  maxBudgetUsd: number;
}

/**
 * Phase 2 implement contract: fresh print-mode process, no resume/custom settings,
 * Read/Edit/Write only, and a CLI-enforced per-dispatch budget. The surrounding
 * implement-sandbox owns cwd, stdin, replacement env, bwrap and process limits.
 */
export function buildClaudeImplementCliArgs(
  input: ClaudeImplementCliArgsInput,
): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    input.model,
  ];
  if (input.effort) args.push("--effort", input.effort);
  args.push(
    "--system-prompt",
    input.systemPrompt,
    "--safe-mode",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--no-chrome",
    "--permission-mode",
    "acceptEdits",
    "--tools",
    "Read,Edit,Write",
    "--max-budget-usd",
    String(input.maxBudgetUsd),
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
  );
  return args;
}

/** Shape pinned by probe #3 (design §2.2); every field stays `unknown` until narrowed. */
interface CliJson {
  type?: unknown;
  is_error?: unknown;
  result?: unknown;
  session_id?: unknown;
  api_error_status?: unknown;
  terminal_reason?: unknown;
  total_cost_usd?: unknown;
  modelUsage?: unknown;
  permission_denials?: unknown;
}

function truncate(value: string, limit = 500): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

function describe(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string"
    ? truncate(value)
    : truncate(JSON.stringify(value) ?? String(value));
}

const invalidResume =
  /no (?:session|conversation).*(?:found|exists)|(?:session|conversation|resume).*(?:invalid|expired|not found|does not exist|unknown)|(?:invalid|expired|not found|does not exist|unknown).*(?:session|conversation|resume)/is;

function errorForResult(parsed: CliJson, stderr: string, resumeSessionId?: string): Error {
  const status = describe(parsed.api_error_status);
  const terminal = describe(parsed.terminal_reason);
  const result = describe(parsed.result);
  const stderrText = truncate(stderr);
  const message = [
    "Claude CLI returned an error",
    status ? `api_error_status=${status}` : "",
    terminal ? `terminal_reason=${terminal}` : "",
    result ? `result=${result}` : "",
    stderrText ? `stderr=${stderrText}` : "",
  ].filter(Boolean).join("; ");

  const quotaDiagnostic = `${status ?? ""} ${terminal ?? ""} ${result ?? ""} ${stderrText}`;
  const quotaMessages = [
    /\b(?:rate|usage)[_-]limit(?:ed|_error)?\b/i,
    /\b(?:rate|usage)[ -]limit(?:ed| (?:error|reached|exceeded|exhausted))\b/i,
    /\bquota[\s_-]*(?:exhausted|exceeded)\b/i,
    /\b(?:daily|weekly|monthly)[\s_-]*(?:usage[\s_-]*)?limit\b/i,
    /\bhit\s+(?:your\s+|the\s+)?(?:(?:daily|weekly|monthly)\s+)?(?:usage\s+)?limit\b/i,
  ];
  if (
    String(parsed.api_error_status) === "429" ||
    quotaMessages.some((pattern) => pattern.test(quotaDiagnostic))
  ) {
    return new ClaudeCliQuotaError(message, parsed.api_error_status);
  }

  // Resume failure has no structured signal in the CLI's JSON, so this is a text heuristic and is
  // only consulted when we actually asked to resume. It is deliberately fail-safe in one
  // direction: a miss degrades to ClaudeCliInvocationError (surfaced, no retry) rather than
  // triggering a spurious fresh-session retry.
  const resumeDiagnostic = `${terminal ?? ""} ${result ?? ""} ${stderrText}`;
  if (resumeSessionId && invalidResume.test(resumeDiagnostic)) {
    return new ClaudeCliResumeInvalidError(message);
  }
  return new ClaudeCliInvocationError(message);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseClaudeCliResult(
  stdout: string,
  input: Pick<ClaudeCliRunInput, "model" | "resumeSessionId">,
  stderr = "",
  exitCode = 0,
): ClaudeCliRunResult {
  let parsed: CliJson;
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    parsed = value as CliJson;
  } catch {
    const raw = truncate(stdout);
    const stderrText = truncate(stderr);
    const message =
      `Claude CLI returned invalid JSON${exitCode ? ` after exit code ${exitCode}` : ""}` +
        `${raw ? `: ${raw}` : " (empty stdout)"}` +
        `${stderrText ? `; stderr=${stderrText}` : ""}`;
    if (input.resumeSessionId && invalidResume.test(stderr)) {
      throw new ClaudeCliResumeInvalidError(message);
    }
    throw new ClaudeCliInvocationError(message);
  }
  if (parsed.type !== "result" || parsed.is_error !== false) {
    throw errorForResult(parsed, stderr, input.resumeSessionId);
  }
  if (exitCode !== 0) {
    throw new ClaudeCliInvocationError(
      `Claude CLI exited with code ${exitCode}` +
        `${stderr.trim() ? `; stderr=${truncate(stderr)}` : ""}`,
    );
  }
  if (typeof parsed.result !== "string" || typeof parsed.session_id !== "string") {
    throw new ClaudeCliInvocationError(
      "Claude CLI result JSON is missing string result/session_id fields",
    );
  }

  // Usage is summed ACROSS models, not read off the top-level `usage` block: a single --safe-mode
  // call still shows a claude-haiku sidecar entry (design §2.1 constraint 3), and the top-level
  // input_tokens excludes cache reads/creations (probe measured input_tokens=10 against
  // cache_creation=15238), so the cache fields must be folded into the input figure.
  const modelUsage =
    parsed.modelUsage && typeof parsed.modelUsage === "object"
      ? parsed.modelUsage as Record<string, unknown>
      : {};
  let inputTokens = 0;
  let outputTokens = 0;
  for (const value of Object.values(modelUsage)) {
    if (!value || typeof value !== "object") continue;
    const usage = value as Record<string, unknown>;
    inputTokens += finiteNumber(usage.inputTokens) ?? 0;
    inputTokens += finiteNumber(usage.cacheReadInputTokens) ?? 0;
    inputTokens += finiteNumber(usage.cacheCreationInputTokens) ?? 0;
    outputTokens += finiteNumber(usage.outputTokens) ?? 0;
  }

  // Context denominator comes from what the CLI actually reports for the requested model (design
  // §2.1 constraint 4: the configured 200000 default is wrong here — opus-5 reports 1,000,000).
  const mainUsage = modelUsage[input.model];
  const contextWindow =
    mainUsage && typeof mainUsage === "object"
      ? finiteNumber((mainUsage as Record<string, unknown>).contextWindow)
      : undefined;
  const warnings = contextWindow === undefined
    ? [`Claude CLI did not report contextWindow for ${input.model}; using configured fallback`]
    : [];
  // Passed through for diagnostics ONLY. Under a subscription this is equivalent-value
  // accounting, not a charge, so it must never be reported as real spend or fed to a
  // money-based breaker (design §2.1 constraint 2).
  const totalCostUsd = finiteNumber(parsed.total_cost_usd);

  return {
    text: parsed.result,
    sessionId: parsed.session_id,
    usage: { inputTokens, outputTokens },
    ...(contextWindow === undefined ? {} : { contextWindow }),
    warnings,
    ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
    ...(Array.isArray(parsed.permission_denials)
      ? { permissionDenials: parsed.permission_denials }
      : {}),
  };
}

export class ClaudeCliClient {
  readonly resolution: ClaudeCliResolution;
  constructor(
    opts: { cliPath?: string } = {},
    private readonly deps: ClaudeCliDeps = defaultDeps,
  ) {
    this.resolution = resolveClaudeCliOnce(opts, deps);
  }
  runTurn(input: ClaudeCliRunInput): Promise<ClaudeCliRunResult> {
    return new Promise((resolve, reject) => {
      const args = buildClaudeCliArgs(input);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.deps.spawn(this.resolution.binaryPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          cwd: input.workingDirectory,
        });
      } catch (error) {
        reject(new ClaudeCliInvocationError(`Failed to start Claude CLI: ${String(error)}`));
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      const fail = (error: ClaudeCliInvocationError): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", (error) => {
        fail(new ClaudeCliInvocationError(
          `Failed to start Claude CLI: ${error.message}` +
            `${stderr.trim() ? `; stderr=${truncate(stderr)}` : ""}`,
        ));
      });
      child.stdin.once("error", (error) => {
        fail(new ClaudeCliInvocationError(`Failed to write Claude CLI stdin: ${error.message}`));
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        try {
          resolve(parseClaudeCliResult(stdout, input, stderr, code ?? -1));
        } catch (error) {
          reject(error);
        }
      });
      try {
        child.stdin.end(input.userPrompt);
      } catch (error) {
        fail(new ClaudeCliInvocationError(`Failed to write Claude CLI stdin: ${String(error)}`));
      }
    });
  }
}
