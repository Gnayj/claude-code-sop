// Codex SDK wrapper.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §6.1.1 + §6.3 + §15.7 M1
//
// SDK actual API (verified against `@openai/codex-sdk@0.128.0` typings 2026-05-05):
//   - Codex class: `startThread(opts?)` and `resumeThread(id, opts?)` are SYNC, return Thread.
//   - Thread.run(input) returns { items, finalResponse, usage }.
//   - ThreadOptions actual names (verified):
//       sandboxMode: "read-only" | "workspace-write" | "danger-full-access"
//       approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted"
//       networkAccessEnabled: boolean   (NOT `network`)
//       webSearchEnabled: boolean       (NOT `webSearch`)
//       webSearchMode: "disabled" | "cached" | "live"
//       workingDirectory: string
//   - Usage: { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
//     (no totalTokens — server computes sum).
//
// Per task card §5 hard-constraint 5: SDK names already verified against package typings;
// any future SDK API change is fix-in-place here.
import { Codex } from "@openai/codex-sdk";
import { IMPLEMENT_MIN_POLICY, MIN_SAFETY_POLICY } from "./safety.js";
export class CodexCapabilityMissingError extends Error {
    constructor(missing) {
        super(`Codex SDK is missing required capabilities: ${missing.join(", ")}. ` +
            `Server cannot run because MIN_SAFETY_POLICY (sandboxMode/approvalPolicy/network/webSearch) ` +
            `must be enforceable. Please upgrade @openai/codex-sdk.`);
        this.name = "CodexCapabilityMissingError";
    }
}
/**
 * Thread options forced on every startThread/resumeThread invocation.
 * Maps our internal MIN_SAFETY_POLICY (which uses canonical short names like `network`)
 * to the actual SDK ThreadOptions field names.
 */
export function forcedThreadOptions(tier = "review") {
    if (tier === "implement") {
        return {
            sandboxMode: IMPLEMENT_MIN_POLICY.sandboxMode, // workspace-write (scratch-scoped)
            approvalPolicy: IMPLEMENT_MIN_POLICY.approvalPolicy,
            networkAccessEnabled: IMPLEMENT_MIN_POLICY.network, // false
            webSearchEnabled: IMPLEMENT_MIN_POLICY.webSearch, // false
            webSearchMode: "disabled",
        };
    }
    return {
        sandboxMode: MIN_SAFETY_POLICY.sandboxMode,
        approvalPolicy: MIN_SAFETY_POLICY.approvalPolicy,
        networkAccessEnabled: MIN_SAFETY_POLICY.network, // false
        webSearchEnabled: MIN_SAFETY_POLICY.webSearch, // false
        webSearchMode: "disabled",
    };
}
/**
 * Concrete CodexClient backed by `@openai/codex-sdk`.
 *
 * The Codex constructor is lazily invoked on first use so tests can avoid
 * touching the real SDK by providing their own CodexClient implementation.
 */
export class OpenAICodexClient {
    options;
    agent = null;
    constructor(options = {}) {
        this.options = options;
    }
    getAgent() {
        if (this.agent !== null)
            return this.agent;
        try {
            this.agent = new Codex({
                ...(this.options.env ? { env: this.options.env } : {}),
                ...(this.options.config ? { config: this.options.config } : {}),
            });
        }
        catch (err) {
            throw new CodexCapabilityMissingError([
                `cannot construct Codex from @openai/codex-sdk: ${err.message}`,
            ]);
        }
        return this.agent;
    }
    async startThread(opts) {
        const agent = this.getAgent();
        const thread = agent.startThread({
            workingDirectory: opts.workingDirectory,
            ...(opts.model || this.options.defaultModel
                ? { model: opts.model || this.options.defaultModel }
                : {}),
            ...forcedThreadOptions(opts.tier ?? "review"),
        });
        // For a fresh thread, SDK populates Thread.id only after the first run.
        // Wrap with no fallback; caller must call runTurn before reading threadId.
        return wrapThread(thread, null);
    }
    async resumeThread(threadId, opts) {
        const agent = this.getAgent();
        const thread = agent.resumeThread(threadId, {
            ...(opts?.workingDirectory ? { workingDirectory: opts.workingDirectory } : {}),
            ...(opts?.model || this.options.defaultModel
                ? { model: opts?.model || this.options.defaultModel }
                : {}),
            ...forcedThreadOptions(opts?.tier ?? "review"),
        });
        // Resume case: caller already knows the id; surface it immediately.
        return wrapThread(thread, threadId);
    }
    async ping() {
        // Lazy-construct only; if it throws here, caller treats as `codex_unavailable`.
        this.getAgent();
    }
}
function wrapThread(thread, fallbackId) {
    return {
        // SDK Thread.id is null until first run starts. For resumed threads we have
        // the id from caller (fallbackId). For new threads it stays empty until
        // runTurn populates Thread.id; access before that returns "".
        get threadId() {
            return thread.id ?? fallbackId ?? "";
        },
        async runTurn(input, signal) {
            const turn = await thread.run(input, signal ? { signal } : undefined);
            const text = turn.finalResponse;
            if (!text) {
                throw new CodexCapabilityMissingError([
                    "thread.run returned empty finalResponse",
                ]);
            }
            const u = turn.usage;
            const usage = u
                ? {
                    inputTokens: u.input_tokens,
                    outputTokens: u.output_tokens,
                    totalTokens: (u.input_tokens ?? 0) +
                        (u.cached_input_tokens ?? 0) +
                        (u.output_tokens ?? 0) +
                        (u.reasoning_output_tokens ?? 0),
                }
                : null;
            return { text, usage };
        },
    };
}
//# sourceMappingURL=codex-client.js.map