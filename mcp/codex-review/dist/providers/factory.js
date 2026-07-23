// Provider factory — selects a ReviewProvider from config.review.provider (design §4.7).
//
// slice 2 implements CodexProvider only. claude / manual throw an explicit
// "implemented in slice 3" error so a misconfigured provider fails loud + actionable
// rather than silently. The factory is the single place run-review-flow / server choose
// a backend; switching providers is a one-line config change (§8.3).
import { resolve as resolvePath } from "node:path";
import { OpenAICodexClient } from "../codex-client.js";
import { AnthropicClaudeClient } from "../claude-client.js";
import { CodexProvider } from "./codex.js";
import { ClaudeProvider } from "./claude.js";
import { ManualProvider } from "./manual.js";
// Strong default claude model when review.claude.model is unset (Q5 "fresh high-effort
// instance"). Overridable via [review.claude].model.
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
/** The §1.D heterogeneous-review invariant: a stage's reviewer is the other model. */
export function counterpartOf(owner) {
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
export function providerKindForStage(stage, config) {
    if (config.review.provider === "manual")
        return "manual";
    const { design_owner, implement_owner } = config.collaboration;
    if (design_owner === undefined && implement_owner === undefined) {
        return config.review.provider; // legacy mode: global reviewer, pre-flow-matrix behavior
    }
    if (stage === "design")
        return counterpartOf(design_owner ?? "claude");
    return counterpartOf(implement_owner ?? "claude");
}
export function createReviewProvider(deps) {
    const provider = deps.kindOverride ?? deps.config.review.provider;
    switch (provider) {
        case "codex": {
            const model = deps.config.review.codex.model ||
                deps.config.codex.default_model ||
                undefined;
            const codexClient = deps.codexClient ?? new OpenAICodexClient({ defaultModel: model });
            return new CodexProvider(codexClient, {
                workingDirectory: deps.workingDirectory,
                model,
            });
        }
        case "claude": {
            const c = deps.config.review.claude;
            const claudeClient = deps.claudeClient ?? new AnthropicClaudeClient({ keyEnv: c.key_env });
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
            const _never = provider;
            throw new Error(`Unknown review.provider: ${String(_never)}`);
        }
    }
}
//# sourceMappingURL=factory.js.map