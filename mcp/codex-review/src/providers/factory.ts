// Provider factory — selects a ReviewProvider from config.review.provider (design §4.7).
//
// slice 2 implements CodexProvider only. claude / manual throw an explicit
// "implemented in slice 3" error so a misconfigured provider fails loud + actionable
// rather than silently. The factory is the single place run-review-flow / server choose
// a backend; switching providers is a one-line config change (§8.3).

import { resolve as resolvePath } from "node:path";
import type { ResolvedConfig } from "../config.js";
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
}

export function createReviewProvider(deps: ProviderFactoryDeps): ReviewProvider {
  const provider = deps.config.review.provider;
  switch (provider) {
    case "codex": {
      const model =
        deps.config.review.codex.model ||
        deps.config.codex.default_model ||
        undefined;
      const codexClient =
        deps.codexClient ?? new OpenAICodexClient({ defaultModel: model });
      return new CodexProvider(codexClient, {
        workingDirectory: deps.workingDirectory,
        model,
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
