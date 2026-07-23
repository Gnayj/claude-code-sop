#!/usr/bin/env node
// MCP server entry. Wires config -> safety -> codex client -> review flow -> MCP transport.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §2 (整体架构) + §10 (代码组织)

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, resolveProjectPath, type ResolvedConfig } from "./config.js";
import { enforceMinSafetyPolicy } from "./safety.js";
import { createReviewProvider } from "./providers/factory.js";
import type { ProviderKind } from "./types.js";
import type { ReviewProvider } from "./review-provider.js";
import { ThreadManager } from "./thread-manager.js";
import { PromptRenderer } from "./prompt-renderer.js";
import { BreakerEngine, initialBreakerState } from "./circuit-breakers.js";
import {
  designReviewToolName,
  designReviewToolSchema,
  handleDesignReview,
} from "./tools/design-review.js";
import {
  codeReviewToolName,
  codeReviewToolSchema,
  handleCodeReview,
} from "./tools/code-review.js";
import {
  fixReviewToolName,
  fixReviewToolSchema,
  handleFixReview,
} from "./tools/fix-review.js";
import {
  implementToolName,
  implementToolSchema,
  handleImplement,
} from "./tools/implement.js";
import type { FlowDependencies } from "./run-review-flow.js";
import type { ImplementFlowDependencies } from "./run-implement-flow.js";
import { ImplementStore } from "./implement-workspace.js";
import { OpenAICodexClient } from "./codex-client.js";

interface ParsedArgs {
  configPath: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let configPath = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" && i + 1 < argv.length) {
      configPath = argv[i + 1] as string;
      i++;
    }
  }
  if (!configPath) {
    throw new Error(
      "Usage: codex-review-mcp --config <path-to-.codex-review/config.toml>",
    );
  }
  return { configPath: resolvePath(configPath) };
}

// Process-level guards: log diagnostics but do NOT crash the process on transient errors;
// stdio MCP transport must remain alive while stdin is open.
process.on("uncaughtException", (err: Error) => {
  process.stderr.write(
    `[codex-review-mcp] uncaughtException: ${err.message}\n${err.stack ?? ""}\n`,
  );
});
process.on("unhandledRejection", (reason: unknown) => {
  const r = reason as Error | { message?: string };
  process.stderr.write(
    `[codex-review-mcp] unhandledRejection: ${r?.message ?? String(reason)}\n`,
  );
});

async function main(): Promise<void> {
  process.stderr.write(`[codex-review-mcp] starting (pid=${process.pid})\n`);
  const { configPath } = parseArgs(process.argv.slice(2));

  // Degraded-start (graceful): a missing / invalid config must NOT crash the server — the MCP
  // client reports a crash as "Connection closed". Instead the bridge still connects + lists its
  // tools, and tool CALLS return a clear, actionable error. The common case is a fresh install
  // before /sop-init has written .codex-review/config.toml.
  let deps: FlowDependencies | null = null;
  let implementDeps: ImplementFlowDependencies | null = null;
  let configError: string | null = null;
  try {
    if (!existsSync(configPath)) {
      configError =
        `ccsop review bridge: config not found at ${configPath}. ` +
        `Run /sop-init to scaffold .codex-review/config.toml, then /reload-plugins.`;
    } else {
      const loaded = loadConfig({ configPath });
      // Defense in depth: reject any project config that tries to relax MIN_SAFETY_POLICY.
      enforceMinSafetyPolicy(loaded.config, loaded.raw);
      const baseDir = dirname(configPath);
      const config = loaded.config;
      const projectRoot = resolveProjectPath(config, baseDir, ".");
      const sessionsDir = resolveProjectPath(config, baseDir, config.paths.sessions_dir);
      const archiveDir = resolveProjectPath(config, baseDir, config.paths.archive_dir);
      const threadManager = new ThreadManager({
        sessionsDir,
        archiveDir,
        lockTimeoutSeconds: config.state.lock_timeout_seconds,
      });
      const promptRenderer = new PromptRenderer(config, projectRoot);
      const breakers = new BreakerEngine(config);
      const breakerState = initialBreakerState();
      // Review backends are constructed lazily PER KIND (flow matrix, collaboration.md §1.D):
      // the stage→kind derivation happens per call in run-review-flow; this memoized registry
      // hands it a backend for whatever kind it resolves (legacy configs only ever ask for
      // config.review.provider's kind). The factory constructs the SDK-backed client
      // internally for codex / claude.
      const providerCache = new Map<ProviderKind, ReviewProvider>();
      const providerFor = (kind: ProviderKind): ReviewProvider => {
        const cached = providerCache.get(kind);
        if (cached) return cached;
        const created = createReviewProvider({
          config,
          workingDirectory: projectRoot,
          sessionsDir,
          kindOverride: kind,
        });
        providerCache.set(kind, created);
        return created;
      };
      deps = {
        config,
        configBaseDir: baseDir,
        providerFor,
        threadManager,
        promptRenderer,
        breakers,
        breakerState,
      };
      // codex_implement (proposal mode, design ccsop-codex-implement): writer runs a fresh
      // OpenAICodexClient per dispatch with the isolated CODEX_HOME env (§4.2.C) at the
      // implement tier (workspace-write scoped to the scratch root).
      implementDeps = {
        config,
        configBaseDir: baseDir,
        // State/locks anchor at the control root (.codex-review/implement-state, design
        // §4.2.E), no-follow-resolved per operation — the configured sessions_dir is
        // deliberately not honored here.
        store: new ImplementStore(projectRoot),
        runWriterTurn: async (req) => {
          // FRESH thread per dispatch (design Q16, user-ratified): every dispatch carries its
          // complete context; the disposable CODEX_HOME makes cross-dispatch resume moot. The
          // per-dispatch thread id is recorded for audit only. The sandbox tmp exclusions
          // (Q19) ride both the server-authored CODEX_HOME config AND the CLI --config
          // overrides; cancellation rides TurnOptions.signal (design §4.4).
          const client = new OpenAICodexClient({
            ...(req.model ? { defaultModel: req.model } : {}),
            env: req.env,
            ...(req.cliConfigOverrides ? { config: req.cliConfigOverrides } : {}),
          });
          const thread = await client.startThread({
            workingDirectory: req.scratchRoot,
            tier: "implement",
          });
          const turn = await thread.runTurn(req.prompt, req.signal);
          return {
            text: turn.text,
            threadId: thread.threadId,
            ...(turn.usage?.totalTokens != null ? { tokensTotal: turn.usage.totalTokens } : {}),
          };
        },
      };
    }
  } catch (err) {
    // Invalid config (schema / safety-policy / provider-selection): stay degraded with the
    // specific reason rather than crashing the transport.
    configError = `ccsop review bridge: config load failed for ${configPath}: ${(err as Error).message}`;
  }
  if (configError) {
    process.stderr.write(`[codex-review-mcp] degraded: ${configError}\n`);
  }

  const server = new Server(
    {
      name: "codex-review-mcp",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      designReviewToolSchema,
      codeReviewToolSchema,
      fixReviewToolSchema,
      // Listed even when [implement] enabled=false — a disabled call returns the actionable
      // enable-instructions error (design §4.3 default-off).
      implementToolSchema,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    // Degraded mode: no usable config → return the actionable reason instead of dispatching.
    if (deps === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: false, error: configError ?? "ccsop review bridge not initialized" },
              null,
              2,
            ),
          },
        ],
      };
    }
    const d = deps; // narrowed to FlowDependencies for the closure below
    if (name === implementToolName) {
      // Separate result shape from the review envelope — return the flow result directly.
      try {
        const impl = implementDeps;
        if (impl === null) throw new Error(configError ?? "bridge not initialized");
        // MCP cancellation: a cancelled call must never publish (design §4.1; the SDK cannot
        // abort a running turn mid-flight — the flow checks the signal at each boundary).
        const result = await handleImplement(impl, args ?? {}, extra?.signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...(result.ok ? {} : { isError: true }),
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: false, error: (err as Error).message, stack: (err as Error).stack },
                null,
                2,
              ),
            },
          ],
        };
      }
    }
    const dispatch = async () => {
      if (name === designReviewToolName) {
        return handleDesignReview(d, args ?? {});
      }
      if (name === codeReviewToolName) {
        return handleCodeReview(d, args ?? {});
      }
      if (name === fixReviewToolName) {
        return handleFixReview(d, args ?? {});
      }
      throw new Error(`Unknown tool: ${name}`);
    };
    try {
      const result = await dispatch();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: result.ok,
                envelope: result.envelope ?? null,
                breaker_tripped: result.breakerTripped ?? null,
                warnings: result.warnings,
                // Manual two-phase prepare (design §4.7): no parse ran; surface the awaiting control result.
                awaiting_manual: result.awaitingManual ?? null,
                parse_failure:
                  result.parseResult && !result.parseResult.ok
                    ? result.parseResult
                    : null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: (err as Error).message,
                stack: (err as Error).stack,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  });

  // Surface "ready" BEFORE connect so observers can grep stderr even if a downstream
  // bug terminates the connect handshake.
  process.stderr.write(
    `[codex-review-mcp] ready (config=${configPath}, mode=${deps ? "active" : "degraded"})\n`,
  );

  const transport = new StdioServerTransport();
  process.stderr.write(`[codex-review-mcp] before-connect\n`);
  try {
    await server.connect(transport);
  } catch (err) {
    process.stderr.write(
      `[codex-review-mcp] connect-failed: ${(err as Error).message}\n${(err as Error).stack ?? ""}\n`,
    );
    throw err;
  }
  process.stderr.write(`[codex-review-mcp] after-connect\n`);

  // Keep the Node event loop alive with a refed timer.
  // `await new Promise(() => {})` is NOT sufficient: a never-resolving promise has no
  // refed handle on its own; if stdin happens to be paused / unrefed in some sandbox
  // setups, Node will treat the loop as empty and exit.  A real refed setInterval
  // guarantees we stay alive regardless of stdin behavior.
  // `process.stdin.resume()` is also called explicitly to ref the stdin handle in
  // environments where the SDK's `.on('data', ...)` does not auto-resume.
  process.stdin.resume();
  const keepAlive = setInterval(() => {
    /* refed no-op; runtime cost ~0 */
  }, 60_000);
  process.on("SIGINT", () => {
    clearInterval(keepAlive);
    process.stderr.write(`[codex-review-mcp] SIGINT — exiting\n`);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(keepAlive);
    process.stderr.write(`[codex-review-mcp] SIGTERM — exiting\n`);
    process.exit(0);
  });

  process.stderr.write(`[codex-review-mcp] entering serve loop\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`[codex-review-mcp] fatal: ${(err as Error).message}\n`);
  if ((err as Error).stack) {
    process.stderr.write(`${(err as Error).stack}\n`);
  }
  process.exit(1);
});
