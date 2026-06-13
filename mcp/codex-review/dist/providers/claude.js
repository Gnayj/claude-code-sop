// ClaudeProvider — review via the Anthropic SDK (design §4.7, Q5 option A).
//
// Heterogeneity caveat (Q5, written honestly in config/README): a claude review LOSES the
// cross-model signal that codex provides (codex has caught real bugs claude missed). To
// partially compensate, ClaudeProvider runs a FRESH instance per turn with a strong
// ADVERSARIAL reviewer system prompt — it does not converse with itself across rounds
// (cross-round continuity is already injected into the prompt by the orchestrator via
// previous_round_* + cold-start preface). It therefore reports a single-turn
// context_usage_pct estimate (input_tokens / context_window), surfaced to the orchestrator
// which is authoritative for context_usage_pct.
/**
 * Adversarial reviewer framing. Because claude lacks the cross-model heterogeneity of codex,
 * it is pushed to be maximally skeptical and to never rubber-stamp.
 */
export const CLAUDE_ADVERSARIAL_SYSTEM = [
    "You are an INDEPENDENT, ADVERSARIAL reviewer for a software delivery SOP.",
    "You did NOT write the code or the design under review. Assume it contains bugs, gaps, and",
    "scope drift until proven otherwise. Do NOT rubber-stamp. Actively hunt for: spec deviations,",
    "missing tests/artifacts, broken invariants, unsafe edits, and stale handoff/doc state.",
    "You are the only review signal here, so be stricter than a peer reviewer would be.",
    "Follow the review order and rules given in the user message exactly, and output ONLY the",
    "single required envelope JSON object — no prose, no markdown fences.",
].join(" ");
export class ClaudeProvider {
    client;
    opts;
    kind = "claude";
    constructor(client, opts) {
        this.client = client;
        this.opts = opts;
    }
    // claude is per-turn fresh: no resumable conversation. The session is a stable synthetic
    // handle so the orchestrator can persist a provider_kind without cross-provider reuse (Q7).
    async openSession(stage, designId, _prior) {
        return {
            kind: "claude",
            designId,
            stage,
            externalSessionId: `claude:${designId}:${stage}`,
        };
    }
    async runTurn(input, session) {
        const result = await this.client.runTurn({
            system: CLAUDE_ADVERSARIAL_SYSTEM,
            model: this.opts.model,
            maxTokens: this.opts.maxTokens,
            userPrompt: input.text,
        });
        const inputTokens = result.usage.inputTokens;
        const contextUsagePct = inputTokens !== null && this.opts.contextWindow > 0
            ? Math.min(1, inputTokens / this.opts.contextWindow)
            : undefined;
        return {
            kind: "turn",
            text: result.text,
            usage: {
                input: result.usage.inputTokens,
                output: result.usage.outputTokens,
                total: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) || null,
                context_usage_pct: contextUsagePct,
            },
            provider_session_id: session.externalSessionId,
        };
    }
    closeSession(_session) {
        // Stateless per-turn; nothing to release.
    }
}
//# sourceMappingURL=claude.js.map