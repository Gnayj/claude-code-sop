// Anthropic SDK wrapper for the claude review provider (design §4.7 / Q5).
//
// SDK API verified against @anthropic-ai/sdk@^0.104.1 typings:
//   - default export: `Anthropic` (constructed with { apiKey }).
//   - client.messages.create({ model, max_tokens, system, messages }) -> Message.
//   - Message.content: ContentBlock[]; text blocks have { type:"text", text }.
//   - Message.usage: { input_tokens: number|null, output_tokens: number|null, ... }.
//
// Like codex-client, the concrete client is injectable so tests can provide a mock and
// never touch the network / require a key.
import Anthropic from "@anthropic-ai/sdk";
export class ClaudeKeyMissingError extends Error {
    constructor(keyEnv) {
        super(`review.provider='claude' requires the API key env var '${keyEnv}' to be set. ` +
            `Export it or switch review.provider.`);
        this.name = "ClaudeKeyMissingError";
    }
}
/** Concrete ClaudeClient backed by @anthropic-ai/sdk. Lazy-constructs the SDK on first use. */
export class AnthropicClaudeClient {
    opts;
    client = null;
    constructor(opts) {
        this.opts = opts;
    }
    getClient() {
        if (this.client !== null)
            return this.client;
        const apiKey = process.env[this.opts.keyEnv];
        if (!apiKey)
            throw new ClaudeKeyMissingError(this.opts.keyEnv);
        this.client = new Anthropic({ apiKey });
        return this.client;
    }
    async runTurn(input) {
        const client = this.getClient();
        const message = await client.messages.create({
            model: input.model,
            max_tokens: input.maxTokens,
            system: input.system,
            messages: [{ role: "user", content: input.userPrompt }],
        });
        // Concatenate all text blocks (tool_use / thinking blocks are ignored for review text).
        const text = message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
        if (!text) {
            throw new Error("Claude returned no text content for the review turn");
        }
        return {
            text,
            usage: {
                inputTokens: message.usage?.input_tokens ?? null,
                outputTokens: message.usage?.output_tokens ?? null,
            },
        };
    }
}
//# sourceMappingURL=claude-client.js.map