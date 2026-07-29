import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildClaudeImplementCliArgs,
  parseClaudeCliResult,
} from "./claude-cli-client.js";
import type { ResolvedConfig } from "./config.js";
import { findExecutableOnPath } from "./codex-resolve.js";
import type {
  WriterTurnRequest,
  WriterTurnResult,
} from "./run-implement-flow.js";
import {
  materializeScratch,
  type Delta,
  type Snapshot,
} from "./implement-workspace.js";

export const CLAUDE_IMPLEMENT_SYSTEM = `You are a bounded implementation writer.
Work only in the current scratch repository and edit only the exact files listed by the task.
You have Read, Edit, and Write only. Never request Bash, Web, MCP, child processes, git operations,
credentials, host files, or paths outside the current workspace. Do not create notes or artifacts.
At completion, return one JSON object with summary, files, tests_run, risks, and notes.`;

const REQUIRED_HELP_FLAGS = [
  "--output-format",
  "--model",
  "--effort",
  "--system-prompt",
  "--safe-mode",
  "--setting-sources",
  "--no-session-persistence",
  "--no-chrome",
  "--permission-mode",
  "--tools",
  "--max-budget-usd",
  "--strict-mcp-config",
  "--mcp-config",
] as const;

export interface BoundedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  wallSeconds: number;
}

export interface ClaudeImplementRuntime {
  binaryPath: string;
  binarySource: "config" | "path";
  binarySha256: string;
  binaryMtimeMs: number;
  binarySize: number;
  installRoot: string;
  credentialPath: string;
  credentialSha256: string;
  bwrapPath: string;
  bwrapSha256: string;
  prlimitPath: string;
  prlimitSha256: string;
}

export interface ClaudeImplementSandboxDeps {
  findOnPath(name: string): string | undefined;
  spawnProcess: typeof spawn;
  spawnSyncProcess: typeof spawnSync;
  now(): number;
}

const defaultDeps: ClaudeImplementSandboxDeps = {
  findOnPath: findExecutableOnPath,
  spawnProcess: spawn,
  spawnSyncProcess: spawnSync,
  now: () => performance.now(),
};

function hashFile(path: string): string {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function assertSecureResolvedPath(path: string): void {
  if (!isAbsolute(path)) throw new Error(`binary path must be absolute: ${path}`);
  let cursor = "/";
  for (const part of path.split("/").filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`resolved binary path contains a symlink: ${cursor}`);
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new Error(`binary path component is group/world writable: ${cursor}`);
    }
  }
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new Error(`Claude CLI must resolve to an executable regular file: ${path}`);
  }
}

function canonicalExecutable(
  configured: string,
  deps: ClaudeImplementSandboxDeps,
): { path: string; source: "config" | "path" } {
  const requested = configured.trim();
  if (requested && !isAbsolute(requested)) {
    throw new Error("[implement.claude].cli_path must be absolute when configured");
  }
  const source = requested ? "config" : "path";
  const candidate = requested || deps.findOnPath("claude");
  if (!candidate) {
    throw new Error(
      "claude_implement requires the Claude CLI; set an absolute implement.claude.cli_path or put claude on PATH",
    );
  }
  const path = realpathSync(candidate);
  assertSecureResolvedPath(path);
  return { path, source };
}

function resolveHostTool(
  name: string,
  deps: ClaudeImplementSandboxDeps,
): string {
  const candidate = deps.findOnPath(name);
  if (!candidate) throw new Error(`claude_implement requires ${name} on PATH`);
  const path = realpathSync(candidate);
  assertSecureResolvedPath(path);
  return path;
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("../") && !isAbsolute(rel));
}

export function inspectClaudeImplementRuntime(
  config: ResolvedConfig,
  repoRoot: string,
  deps: ClaudeImplementSandboxDeps = defaultDeps,
): ClaudeImplementRuntime {
  if (process.platform !== "linux") {
    throw new Error("claude_implement v1 requires Linux and bubblewrap");
  }
  const bwrapPath = resolveHostTool("bwrap", deps);
  const prlimitPath = resolveHostTool("prlimit", deps);
  for (const [command, path] of [
    ["bwrap", bwrapPath],
    ["prlimit", prlimitPath],
  ] as const) {
    const probe =
      command === "bwrap"
        ? deps.spawnSyncProcess(path, [
            "--ro-bind",
            "/",
            "/",
            "--unshare-pid",
            "--die-with-parent",
            "--",
            "/bin/true",
          ])
        : deps.spawnSyncProcess(path, ["--version"]);
    if (probe.error || probe.status !== 0) {
      throw new Error(`${command} capability probe failed`);
    }
  }
  const resolved = canonicalExecutable(config.implement.claude.cli_path, deps);
  if (
    isInside(resolved.path, resolve(repoRoot)) ||
    isInside(resolved.path, "/tmp") ||
    isInside(resolved.path, "/var/tmp")
  ) {
    throw new Error("Claude CLI binary must be outside the repository and temporary roots");
  }
  const stat = statSync(resolved.path);
  const credentialPath = resolve(
    process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || "", ".claude"),
    ".credentials.json",
  );
  if (!isAbsolute(credentialPath) || !existsSync(credentialPath)) {
    throw new Error(
      "Claude OAuth credential file is absent; run `claude` interactively and log in first",
    );
  }
  const credentialStat = lstatSync(credentialPath);
  if (
    !credentialStat.isFile() ||
    credentialStat.isSymbolicLink() ||
    realpathSync(credentialPath) !== credentialPath ||
    (credentialStat.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Claude credential source must be a mode-0600 regular non-symlink file",
    );
  }
  // The native distribution keeps its executable and resources below the package root.
  const installRoot = resolve(dirname(resolved.path), "..");
  return {
    binaryPath: resolved.path,
    binarySource: resolved.source,
    binarySha256: hashFile(resolved.path),
    binaryMtimeMs: stat.mtimeMs,
    binarySize: stat.size,
    installRoot,
    credentialPath,
    credentialSha256: hashFile(credentialPath),
    bwrapPath,
    bwrapSha256: hashFile(bwrapPath),
    prlimitPath,
    prlimitSha256: hashFile(prlimitPath),
  };
}

function replacementEnv(home: string, installRoot: string): Record<string, string> {
  return {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    // The writer binary is launched by absolute path. Keep host utilities (including Bash)
    // outside the namespace instead of advertising paths that are intentionally not mounted.
    PATH: join(installRoot, "bin"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: "/tmp",
    ...(existsSync("/etc/ssl/certs/ca-certificates.crt")
      ? { SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt" }
      : {}),
  };
}

function baseBwrapArgs(
  runtime: ClaudeImplementRuntime,
  scratchRoot: string,
  home: string,
): string[] {
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    "--new-session",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
  ];
  for (const source of [
    "/lib",
    "/lib64",
    "/etc/ssl",
    "/etc/resolv.conf",
    "/etc/hosts",
  ]) {
    if (existsSync(source)) args.push("--ro-bind", source, source);
  }
  args.push(
    "--ro-bind",
    runtime.installRoot,
    runtime.installRoot,
    "--bind",
    scratchRoot,
    scratchRoot,
    "--bind",
    home,
    home,
    "--ro-bind",
    runtime.credentialPath,
    join(home, ".claude", ".credentials.json"),
    "--chdir",
    scratchRoot,
  );
  for (const [key, value] of Object.entries(
    replacementEnv(home, runtime.installRoot),
  )) {
    args.push("--setenv", key, value);
  }
  return args;
}

function killProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

export async function runBoundedProcess(
  command: string,
  args: readonly string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    stdin: string;
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
  },
  deps: ClaudeImplementSandboxDeps = defaultDeps,
): Promise<BoundedResult> {
  if (opts.signal?.aborted) throw new Error("Claude CLI dispatch cancelled");
  const started = deps.now();
  const child = deps.spawnProcess(command, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let outputBytes = 0;
  let terminalError: Error | undefined;
  child.stdin.on("error", (err) => {
    terminalError ??= new Error(`Claude CLI stdin failed: ${err.message}`);
    killProcessGroup(child.pid);
  });
  const append = (
    current: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
  ): Buffer<ArrayBufferLike> => {
    const remaining = Math.max(0, opts.maxOutputBytes - outputBytes);
    outputBytes += chunk.length;
    const accepted = chunk.subarray(0, remaining);
    const combined = Buffer.concat([current, accepted]);
    if (outputBytes > opts.maxOutputBytes) {
      terminalError = new Error(
        `Claude CLI output exceeded max_output_bytes=${opts.maxOutputBytes}`,
      );
      killProcessGroup(child.pid);
    }
    return combined;
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = append(stdout, Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = append(stderr, Buffer.from(chunk));
  });
  const onAbort = (): void => {
    terminalError = new Error("Claude CLI dispatch cancelled");
    killProcessGroup(child.pid);
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    terminalError = new Error(
      `Claude CLI timed out after ${Math.round(opts.timeoutMs / 1000)} seconds`,
    );
    killProcessGroup(child.pid);
  }, opts.timeoutMs);
  const exit = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
    try {
      child.stdin.end(opts.stdin);
    } catch (err) {
      terminalError = new Error(
        `Claude CLI stdin failed: ${(err as Error).message}`,
      );
      killProcessGroup(child.pid);
    }
  }).finally(() => {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  });
  if (terminalError) throw terminalError;
  if (exit.signal) throw new Error(`Claude CLI terminated by ${exit.signal}`);
  return {
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    exitCode: exit.code ?? -1,
    wallSeconds: Math.max(0, (deps.now() - started) / 1000),
  };
}

function prlimitArgs(
  timeoutSeconds: number,
  bwrapPath: string,
  bwrapArgs: readonly string[],
): string[] {
  return [
    "--nproc=256:256",
    `--cpu=${timeoutSeconds + 30}:${timeoutSeconds + 30}`,
    "--as=8589934592:8589934592",
    "--nofile=1024:1024",
    "--fsize=16777216:16777216",
    "--",
    bwrapPath,
    ...bwrapArgs,
  ];
}

function parseVersion(text: string): [number, number, number] | undefined {
  const match = text.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}

function compareVersion(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return (left[index] ?? 0) < (right[index] ?? 0) ? -1 : 1;
    }
  }
  return 0;
}

export function versionSatisfiesRange(versionText: string, range: string): boolean {
  const version = parseVersion(versionText);
  if (!version) return false;
  const clauses = range.trim().split(/\s+/);
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|>|<=|<|=)?(\d+\.\d+\.\d+)$/);
    if (!match) return false;
    const target = parseVersion(match[2]!);
    if (!target) return false;
    const comparison = compareVersion(version, target);
    switch (match[1] || "=") {
      case ">=":
        return comparison >= 0;
      case ">":
        return comparison > 0;
      case "<=":
        return comparison <= 0;
      case "<":
        return comparison < 0;
      default:
        return comparison === 0;
    }
  });
}

async function runInSandbox(
  runtime: ClaudeImplementRuntime,
  config: ResolvedConfig["implement"]["claude"],
  scratchRoot: string,
  home: string,
  claudeArgs: readonly string[],
  stdin: string,
  signal: AbortSignal | undefined,
  deps: ClaudeImplementSandboxDeps,
  deadlineAt?: number,
): Promise<BoundedResult> {
  const timeoutMs =
    deadlineAt === undefined
      ? config.timeout_seconds * 1000
      : Math.floor(deadlineAt - deps.now());
  if (timeoutMs <= 0) {
    throw new Error(
      `Claude CLI timed out after ${config.timeout_seconds} seconds`,
    );
  }
  const bwrapArgs = [
    ...baseBwrapArgs(runtime, scratchRoot, home),
    "--",
    runtime.binaryPath,
    ...claudeArgs,
  ];
  return runBoundedProcess(
    runtime.prlimitPath,
    prlimitArgs(config.timeout_seconds, runtime.bwrapPath, bwrapArgs),
    {
      cwd: scratchRoot,
      env: replacementEnv(home, runtime.installRoot),
      stdin,
      timeoutMs,
      maxOutputBytes: config.max_output_bytes,
      ...(signal ? { signal } : {}),
    },
    deps,
  );
}

function preparePrivateHome(home: string): void {
  chmodSync(home, 0o700);
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(claudeDir, "settings.json"),
    '{"permissions":{"allow":[],"deny":[]},"hooks":{}}\n',
    { mode: 0o600 },
  );
  const placeholder = join(claudeDir, ".credentials.json");
  if (!existsSync(placeholder)) writeFileSync(placeholder, "", { mode: 0o600 });
}

async function preflight(
  runtime: ClaudeImplementRuntime,
  config: ResolvedConfig["implement"]["claude"],
  scratchRoot: string,
  home: string,
  signal: AbortSignal | undefined,
  deps: ClaudeImplementSandboxDeps,
  deadlineAt: number,
): Promise<{
  version: string;
  certified: boolean;
  helpSha256: string;
  probe: {
    passed: true;
    session_id: string;
    wall_seconds: number;
    budget_limit_usd: number;
    cost_usd: number;
    read_edit_write_passed: true;
    bash_tool_exposed: false;
    caller_repo_mounted: false;
    boundary_attestation: "server-derived mount/tool policy";
  };
}> {
  const versionResult = await runInSandbox(
    runtime,
    config,
    scratchRoot,
    home,
    ["--version"],
    "",
    signal,
    deps,
    deadlineAt,
  );
  if (versionResult.exitCode !== 0) {
    throw new Error(`Claude CLI version probe failed: ${versionResult.stderr}`);
  }
  const version = versionResult.stdout.trim();
  const certified = versionSatisfiesRange(
    version,
    config.supported_version_range,
  );
  if (!certified && !config.allow_uncertified_version) {
    throw new Error(
      `Claude CLI ${version} is outside supported_version_range=${config.supported_version_range}`,
    );
  }
  const helpResult = await runInSandbox(
    runtime,
    config,
    scratchRoot,
    home,
    ["--help"],
    "",
    signal,
    deps,
    deadlineAt,
  );
  if (helpResult.exitCode !== 0) {
    throw new Error(`Claude CLI help probe failed: ${helpResult.stderr}`);
  }
  const missing = REQUIRED_HELP_FLAGS.filter(
    (flag) => !helpResult.stdout.includes(flag),
  );
  if (missing.length > 0) {
    throw new Error(`Claude CLI help is missing required flags: ${missing.join(", ")}`);
  }

  const probePath = join(scratchRoot, ".ccsop-behavior-probe.txt");
  rmSync(probePath, { force: true });
  // The capability probe and the writer share one dispatch budget. Keep the
  // probe small while reserving most of the operator-approved ceiling for work.
  const probeBudgetUsd = Math.min(config.max_budget_usd * 0.25, 0.25);
  const probeArgs = buildClaudeImplementCliArgs({
    model: config.model,
    effort: config.effort,
    systemPrompt:
      "Capability probe. Use only Read/Edit/Write. Follow the request exactly and do not improvise.",
    maxBudgetUsd: probeBudgetUsd,
  });
  const probeResult = await runInSandbox(
    runtime,
    config,
    scratchRoot,
    home,
    probeArgs,
    [
      "Use Write to create .ccsop-behavior-probe.txt containing CCSOP_PROBE_.",
      "Use Edit to append OK, then use Read to verify the final exact bytes are CCSOP_PROBE_OK.",
      "Do not create or edit any other file.",
      'Return exactly {"summary":"probe","files":[".ccsop-behavior-probe.txt"],"tests_run":[],"risks":[]}.',
    ].join("\n"),
    signal,
    deps,
    deadlineAt,
  );
  const parsed = parseClaudeCliResult(
    probeResult.stdout,
    { model: config.model },
    probeResult.stderr,
    probeResult.exitCode,
  );
  let bytes: string;
  try {
    bytes = readFileSync(probePath, "utf8");
  } finally {
    rmSync(probePath, { force: true });
  }
  if (bytes !== "CCSOP_PROBE_OK") {
    throw new Error("Claude behavior probe did not perform the exact in-scratch write/read");
  }
  return {
    version,
    certified,
    helpSha256: createHash("sha256")
      .update(helpResult.stdout, "utf8")
      .digest("hex"),
    probe: {
      passed: true,
      session_id: parsed.sessionId,
      wall_seconds: probeResult.wallSeconds,
      budget_limit_usd: probeBudgetUsd,
      cost_usd: Math.min(
        parsed.totalCostUsd ?? probeBudgetUsd,
        probeBudgetUsd,
      ),
      read_edit_write_passed: true,
      bash_tool_exposed: false,
      caller_repo_mounted: false,
      boundary_attestation: "server-derived mount/tool policy",
    },
  };
}

export async function runClaudeImplementWriter(
  config: ResolvedConfig,
  repoRoot: string,
  request: WriterTurnRequest,
  deps: ClaudeImplementSandboxDeps = defaultDeps,
): Promise<WriterTurnResult> {
  if (!request.privateHome) {
    throw new Error("claude_implement adapter requires a server-private home");
  }
  const runtime = inspectClaudeImplementRuntime(config, repoRoot, deps);
  const deadlineAt =
    deps.now() + config.implement.claude.timeout_seconds * 1000;
  preparePrivateHome(request.privateHome);
  const credentialBefore = hashFile(runtime.credentialPath);
  const binaryBefore = hashFile(runtime.binaryPath);
  const checked = await preflight(
    runtime,
    config.implement.claude,
    request.scratchRoot,
    request.privateHome,
    request.signal,
    deps,
    deadlineAt,
  );
  const args = buildClaudeImplementCliArgs({
    model: config.implement.claude.model,
    effort: config.implement.claude.effort,
    systemPrompt: CLAUDE_IMPLEMENT_SYSTEM,
    maxBudgetUsd:
      config.implement.claude.max_budget_usd -
      checked.probe.budget_limit_usd,
  });
  const result = await runInSandbox(
    runtime,
    config.implement.claude,
    request.scratchRoot,
    request.privateHome,
    args,
    request.prompt,
    request.signal,
    deps,
    deadlineAt,
  );
  const parsed = parseClaudeCliResult(
    result.stdout,
    { model: config.implement.claude.model },
    result.stderr,
    result.exitCode,
  );
  const deniedMutation = (parsed.permissionDenials ?? []).find((denial) =>
    /(?:Edit|Write)/i.test(
      typeof denial === "string" ? denial : JSON.stringify(denial),
    ),
  );
  if (deniedMutation !== undefined) {
    throw new Error(
      `Claude CLI denied a required mutation tool call: ${JSON.stringify(deniedMutation)}`,
    );
  }
  if (
    hashFile(runtime.credentialPath) !== credentialBefore ||
    hashFile(runtime.binaryPath) !== binaryBefore
  ) {
    throw new Error(
      "Claude runtime or credential integrity changed during dispatch; artifact quarantined",
    );
  }
  return {
    text: parsed.text,
    threadId: parsed.sessionId,
    tokensTotal: parsed.usage.inputTokens + parsed.usage.outputTokens,
    wallSeconds: result.wallSeconds + checked.probe.wall_seconds,
    costUsd: Math.min(
      checked.probe.cost_usd +
        (parsed.totalCostUsd ??
          config.implement.claude.max_budget_usd -
            checked.probe.budget_limit_usd),
      config.implement.claude.max_budget_usd,
    ),
    warnings: [
      ...parsed.warnings,
      ...(parsed.permissionDenials?.length
        ? [
            `Claude CLI reported ${parsed.permissionDenials.length} permission denial(s)`,
          ]
        : []),
      "network egress destination is not restricted by bwrap; operator egress policy was not attested",
      "Claude CLI total_cost_usd is subscription-equivalent budget accounting, not billed spend",
      ...(checked.certified
        ? []
        : ["Claude CLI version was accepted under allow_uncertified_version=true"]),
    ],
    writerAttestation: {
      writer_kind: "claude",
      backend: "cli",
      binary_source: runtime.binarySource,
      binary_realpath: runtime.binaryPath,
      binary_sha256: runtime.binarySha256,
      binary_mtime_ms: runtime.binaryMtimeMs,
      binary_size: runtime.binarySize,
      bwrap_realpath: runtime.bwrapPath,
      bwrap_sha256: runtime.bwrapSha256,
      prlimit_realpath: runtime.prlimitPath,
      prlimit_sha256: runtime.prlimitSha256,
      cli_version: checked.version,
      supported_version_range: config.implement.claude.supported_version_range,
      version_certified: checked.certified,
      help_sha256: checked.helpSha256,
      behavioral_probe: checked.probe,
      model: config.implement.claude.model,
      effort: config.implement.claude.effort,
      permission_mode: "acceptEdits",
      tools: ["Read", "Edit", "Write"],
      permission_denials: parsed.permissionDenials ?? [],
      max_budget_usd: config.implement.claude.max_budget_usd,
      budget_accounting: "subscription-equivalent; not billed spend",
      writer_budget_usd:
        config.implement.claude.max_budget_usd -
        checked.probe.budget_limit_usd,
      timeout_seconds: config.implement.claude.timeout_seconds,
      max_output_bytes: config.implement.claude.max_output_bytes,
      sandbox: "linux-bwrap-deny-by-default",
      resource_limits: "prlimit",
      credential: {
        filename: ".credentials.json",
        sha256: runtime.credentialSha256,
        mount: "read-only",
      },
      egress: "provider-required; destination policy not configured",
    },
  };
}

export interface ClaudeValidationCommandResult {
  argv: string[];
  exit_code: number;
  stdout_sha256: string;
  stderr_sha256: string;
  wall_seconds: number;
}

export interface ClaudeProposalValidation {
  status: "pass" | "fail" | "unconfigured";
  applicability: "applicable" | "advisory-only";
  apply_policy:
    | "normal-confirmation"
    | "advisory-opt-in"
    | "export-only";
  reasons: string[];
  validation_affecting_changes: Array<{
    path: string;
    classification: "forced-advisory" | "additive-test-only";
  }>;
  definition_preimage_sha256: string;
  dependency_mounts: string[];
  commands: ClaudeValidationCommandResult[];
  baseline_only: boolean;
}

function validRepoRelative(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function equalOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function globRegex(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index++;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

const RESOLUTION_AFFECTING_SHARED_SOURCE =
  String.raw`(?:^|/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|deno\.jsonc?|bun\.lockb?|pyproject\.toml|poetry\.lock|requirements[^/]*\.txt|cargo\.toml|cargo\.lock|go\.mod|go\.sum|makefile|vite\.config\.[^/]+|vitest\.config\.[^/]+|jest\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json)$`;
const RESOLUTION_AFFECTING = new RegExp(
  `${RESOLUTION_AFFECTING_SHARED_SOURCE}|(?:^|/)[^/]*(?:setup|config|lifecycle)[^/]*$`,
  "i",
);
const RESOLUTION_AFFECTING_OUTSIDE_ROOTS = new RegExp(
  `${RESOLUTION_AFFECTING_SHARED_SOURCE}|^(?:setup|lifecycle)\\.[^/]+$`,
  "i",
);

function definitionHash(
  snapshot: Snapshot,
  roots: readonly string[],
): string {
  const facts: unknown[] = [];
  for (const path of [...snapshot.inventory.keys()].sort()) {
    if (!roots.some((root) => equalOrBelow(path, root))) continue;
    facts.push([path, snapshot.inventory.get(path)]);
  }
  return createHash("sha256")
    .update(JSON.stringify(facts), "utf8")
    .digest("hex");
}

function restoreDefinitionRoots(
  snapshot: Snapshot,
  validationRoot: string,
  roots: readonly string[],
): void {
  for (const root of roots) {
    rmSync(join(validationRoot, root), { recursive: true, force: true });
  }
  for (const [path, entry] of snapshot.inventory) {
    if (!roots.some((root) => equalOrBelow(path, root))) continue;
    if (entry.state !== "present" || entry.kind !== "file") continue;
    const target = join(validationRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    snapshot.store.copyTo(entry.sha, target);
    chmodSync(target, entry.mode === "100755" ? 0o755 : 0o644);
  }
}

function validationDependencyMounts(
  repoRoot: string,
  validationRoot: string,
  definitionPaths: readonly string[],
): Array<{ source: string; target: string; relative: string }> {
  const packageDefinition =
    /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
  const candidates = new Set<string>();
  for (const definitionPath of definitionPaths) {
    const base = packageDefinition.test(definitionPath)
      ? dirname(definitionPath)
      : definitionPath;
    candidates.add(join(repoRoot, base, "node_modules"));
  }
  const mounts: Array<{ source: string; target: string; relative: string }> = [];
  for (const source of [...candidates].sort()) {
    if (!existsSync(source)) continue;
    const stat = lstatSync(source);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(source) !== source ||
      !isInside(source, repoRoot)
    ) {
      throw new Error(
        `validation dependency mount must be a canonical real directory: ${source}`,
      );
    }
    const rel = relative(repoRoot, source).replaceAll("\\", "/");
    const target = join(validationRoot, rel);
    mkdirSync(target, { recursive: true });
    mounts.push({ source, target, relative: rel });
  }
  return mounts;
}

function validationBwrapArgs(
  validationRoot: string,
  dependencyMounts: ReadonlyArray<{ source: string; target: string }>,
  argv: readonly string[],
): string[] {
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-net",
    "--new-session",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
  ];
  for (const path of ["/usr", "/bin", "/lib", "/lib64", "/etc/ssl"]) {
    if (existsSync(path)) args.push("--ro-bind", path, path);
  }
  args.push("--bind", validationRoot, validationRoot);
  for (const mount of dependencyMounts) {
    args.push("--ro-bind", mount.source, mount.target);
  }
  args.push(
    "--chdir",
    validationRoot,
    "--setenv",
    "HOME",
    "/tmp/ccsop-validation-home",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--",
    ...argv,
  );
  return args;
}

export async function validateClaudeProposal(input: {
  config: ResolvedConfig["implement"]["claude"];
  repoRoot: string;
  snapshot: Snapshot;
  deltas: readonly Delta[];
  patch: Buffer;
  validationRoot: string;
  signal?: AbortSignal;
  deps?: ClaudeImplementSandboxDeps;
}): Promise<ClaudeProposalValidation> {
  const deps = input.deps ?? defaultDeps;
  const config = input.config;
  const deadlineAt = deps.now() + config.timeout_seconds * 1000;
  const roots = config.validation_definition_paths;
  const commands = config.validation_commands;
  const reasons: string[] = [];
  const commandResults: ClaudeValidationCommandResult[] = [];
  const affecting: ClaudeProposalValidation["validation_affecting_changes"] = [];
  let dependencyMounts: Array<{
    source: string;
    target: string;
    relative: string;
  }> = [];
  const invalidRoot = roots.find((root) => !validRepoRelative(root));
  if (invalidRoot) reasons.push(`invalid validation definition path: ${invalidRoot}`);
  const invalidGlob = config.validation_additive_test_globs.find(
    (glob) => !validRepoRelative(glob.replaceAll("*", "x").replaceAll("?", "x")),
  );
  if (invalidGlob) reasons.push(`invalid validation additive test glob: ${invalidGlob}`);
  const invalidCommand = commands.find(
    (argv) =>
      argv.length === 0 ||
      argv.some((part) => part.length === 0 || part.includes("\u0000")),
  );
  if (invalidCommand) reasons.push("invalid empty/NUL validation argv");
  if (roots.length === 0 || commands.length === 0) {
    reasons.push(
      "operator validation_commands/validation_definition_paths are unconfigured",
    );
  }

  const additiveMatchers = config.validation_additive_test_globs.map(globRegex);
  for (const delta of input.deltas) {
    const underDefinitionRoot = roots.some((root) =>
      equalOrBelow(delta.path, root),
    );
    const resolutionAffecting = (
      underDefinitionRoot
        ? RESOLUTION_AFFECTING
        : RESOLUTION_AFFECTING_OUTSIDE_ROOTS
    ).test(delta.path);
    if (!underDefinitionRoot && !resolutionAffecting) continue;
    const additive =
      underDefinitionRoot &&
      delta.op === "create" &&
      !resolutionAffecting &&
      additiveMatchers.some((matcher) => matcher.test(delta.path));
    affecting.push({
      path: delta.path,
      classification: additive ? "additive-test-only" : "forced-advisory",
    });
    if (!additive) {
      reasons.push(
        `validation-affecting ${delta.op} forces advisory-only: ${delta.path}`,
      );
    }
  }

  const definitionPreimageSha256 = definitionHash(input.snapshot, roots);
  if (reasons.length === 0) {
    const bwrapPath = resolveHostTool("bwrap", deps);
    const prlimitPath = resolveHostTool("prlimit", deps);
    const gitPath = resolveHostTool("git", deps);
    mkdirSync(input.validationRoot, { recursive: true, mode: 0o700 });
    materializeScratch(input.snapshot, input.validationRoot);
    const gitArgs = [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
    ];
    const gitEnv = {
      PATH: dirname(gitPath),
      HOME: "/dev/null",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    };
    const checked = deps.spawnSyncProcess(gitPath, [
      ...gitArgs,
      "apply",
      "--check",
      "-",
    ], {
      cwd: input.validationRoot,
      input: input.patch,
      env: gitEnv,
      maxBuffer: config.max_output_bytes,
      timeout: Math.max(1, Math.floor(deadlineAt - deps.now())),
    });
    if (checked.error || checked.status !== 0) {
      reasons.push(
        `proposal patch failed git apply --check: ${String(checked.stderr || checked.error)}`,
      );
    } else {
      const applied = deps.spawnSyncProcess(gitPath, [
        ...gitArgs,
        "apply",
        "-",
      ], {
        cwd: input.validationRoot,
        input: input.patch,
        env: gitEnv,
        maxBuffer: config.max_output_bytes,
        timeout: Math.max(1, Math.floor(deadlineAt - deps.now())),
      });
      if (applied.error || applied.status !== 0) {
        reasons.push(
          `proposal patch failed validation apply: ${String(applied.stderr || applied.error)}`,
        );
      }
    }
    if (reasons.length === 0) {
      restoreDefinitionRoots(input.snapshot, input.validationRoot, roots);
      dependencyMounts = validationDependencyMounts(
        input.repoRoot,
        input.validationRoot,
        roots,
      );
      for (const argv of commands) {
        const remainingMs = Math.floor(deadlineAt - deps.now());
        if (remainingMs <= 0) {
          reasons.push(
            `server validation exceeded the aggregate timeout_seconds=${config.timeout_seconds}`,
          );
          break;
        }
        const result = await runBoundedProcess(
          prlimitPath,
          prlimitArgs(
            config.timeout_seconds,
            bwrapPath,
            validationBwrapArgs(input.validationRoot, dependencyMounts, argv),
          ),
          {
            cwd: input.validationRoot,
            env: {
              PATH: "/usr/bin:/bin",
              HOME: "/tmp/ccsop-validation-home",
              TMPDIR: "/tmp",
              LANG: "C.UTF-8",
            },
            stdin: "",
            timeoutMs: remainingMs,
            maxOutputBytes: config.max_output_bytes,
            ...(input.signal ? { signal: input.signal } : {}),
          },
          deps,
        );
        commandResults.push({
          argv: [...argv],
          exit_code: result.exitCode,
          stdout_sha256: createHash("sha256")
            .update(result.stdout, "utf8")
            .digest("hex"),
          stderr_sha256: createHash("sha256")
            .update(result.stderr, "utf8")
            .digest("hex"),
          wall_seconds: result.wallSeconds,
        });
        if (result.exitCode !== 0) {
          reasons.push(
            `validation command exited ${result.exitCode}: ${JSON.stringify(argv)}`,
          );
          break;
        }
      }
    }
  }
  const configured = roots.length > 0 && commands.length > 0;
  const status: ClaudeProposalValidation["status"] = !configured
    ? "unconfigured"
    : reasons.length > 0
      ? "fail"
      : "pass";
  const forcedAdvisory = affecting.some(
    (change) => change.classification === "forced-advisory",
  );
  const applicability =
    status === "pass" && !forcedAdvisory ? "applicable" : "advisory-only";
  return {
    status,
    applicability,
    apply_policy:
      applicability === "applicable"
        ? "normal-confirmation"
        : config.allow_advisory_apply
          ? "advisory-opt-in"
          : "export-only",
    reasons,
    validation_affecting_changes: affecting,
    definition_preimage_sha256: definitionPreimageSha256,
    dependency_mounts: dependencyMounts.map((mount) => mount.relative),
    commands: commandResults,
    baseline_only: affecting.some(
      (change) => change.classification === "additive-test-only",
    ),
  };
}
