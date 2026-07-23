// Provider factory — selects a ReviewProvider from config.review.provider (design §4.7).
//
// slice 2 implements CodexProvider only. claude / manual throw an explicit
// "implemented in slice 3" error so a misconfigured provider fails loud + actionable
// rather than silently. The factory is the single place run-review-flow / server choose
// a backend; switching providers is a one-line config change (§8.3).

import { resolve as resolvePath } from "node:path";
import type { ProviderKind, ReviewStage } from "../types.js";
import type { ResolvedConfig } from "../config.js";
import { resolveCodexTier } from "../config.js";
import type { CodexClient } from "../codex-client.js";
import { OpenAICodexClient } from "../codex-client.js";
import type { ClaudeClient } from "../claude-client.js";
import { AnthropicClaudeClient } from "../claude-client.js";
import type { ReviewProvider } from "../review-provider.js";
import { CodexProvider } from "./codex.js";
import { ClaudeProvider } from "./claude.js";
import { ManualProvider } from "./manual.js";

// Strong default claude model when review.claude.model is unset (Q5 "fresh high-effort
// instance"). Overridable via [review.claude].model.
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";

export interface ProviderFactoryDeps {
  config: ResolvedConfig;
  /** Repo root the backend operates within (= resolveProjectPath(config, baseDir, ".")). */
  workingDirectory: string;
  /** Resolved default sessions dir (paths.sessions_dir) — manual prompt/verdict files. */
  sessionsDir: string;
  /** Injectable clients (tests pass mocks; server passes the real SDK-backed clients). */
  codexClient?: CodexClient;
  claudeClient?: ClaudeClient;
  /** Construct a specific backend instead of config.review.provider — used by the per-stage
   * flow-matrix derivation (collaboration.md §1.D); the config's provider tuning subtables
   * ([review.codex] / [review.claude] / [review.manual]) still apply. */
  kindOverride?: ProviderKind;
}

/** The §1.D heterogeneous-review invariant: a stage's reviewer is the other model. */
export function counterpartOf(owner: "claude" | "codex"): ProviderKind {
  return owner === "claude" ? "codex" : "claude";
}

/**
 * Per-stage reviewer derivation (collaboration.md §1.D, design ccsop-flow-matrix).
 *
 * - `review.provider = manual` short-circuits EVERY stage to manual delivery.
 * - Both `[collaboration]` owner keys absent → legacy mode: `review.provider` governs all
 *   stages exactly as before the flow axis existed (c_legacy_owner_presence — presence is
 *   observable because the schema gives the keys no default).
 * - Otherwise: design → counterpart(design_owner ?? "claude"); code → counterpart(
 *   implement_owner ?? "claude"). The fix stage normally INHERITS the persisted session's
 *   provider_kind (the reviewer who raised the findings re-judges the fix) — that resolution
 *   needs the session state and lives in run-review-flow; this function's "fix" answer is the
 *   no-session fallback and mirrors the code stage.
 */
export function providerKindForStage(
  stage: ReviewStage,
  config: ResolvedConfig,
): ProviderKind {
  if (config.review.provider === "manual") return "manual";
  const { design_owner, implement_owner } = config.collaboration;
  if (design_owner === undefined && implement_owner === undefined) {
    return config.review.provider; // legacy mode: global reviewer, pre-flow-matrix behavior
  }
  if (stage === "design") return counterpartOf(design_owner ?? "claude");
  return counterpartOf(implement_owner ?? "claude");
}

export function createReviewProvider(deps: ProviderFactoryDeps): ReviewProvider {
  const provider = deps.kindOverride ?? deps.config.review.provider;
  switch (provider) {
    case "codex": {
      // CodexProviderOptions is the single model/effort channel: the provider passes both on
      // start AND resume, so injected (test) and SDK clients observe identical opts.
      const { model, effort } = resolveCodexTier(deps.config, "review");
      const codexClient = deps.codexClient ?? new OpenAICodexClient();
      return new CodexProvider(codexClient, {
        workingDirectory: deps.workingDirectory,
        model,
        effort,
      });
    }
    case "claude": {
      const c = deps.config.review.claude;
      const claudeClient =
        deps.claudeClient ?? new AnthropicClaudeClient({ keyEnv: c.key_env });
      return new ClaudeProvider(claudeClient, {
        model: c.model || DEFAULT_CLAUDE_MODEL,
        maxTokens: c.max_tokens,
        contextWindow: c.context_window,
      });
    }
    case "manual": {
      const override = deps.config.review.manual.sessions_dir;
      const sessionsDir = override
        ? resolvePath(deps.workingDirectory, override)
        : deps.sessionsDir;
      return new ManualProvider({ sessionsDir });
    }
    default: {
      // Exhaustiveness guard — ProviderKindSchema should make this unreachable.
      const _never: never = provider;
      throw new Error(`Unknown review.provider: ${String(_never)}`);
    }
  }
}
