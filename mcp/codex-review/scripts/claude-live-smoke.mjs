#!/usr/bin/env node
// Gated live smoke for ClaudeProvider (design §8.3 "ClaudeProvider 真跑一轮 review 出合规 envelope").
//
// Requires ANTHROPIC_API_KEY. Without it the smoke SKIPS (exit 0) and prints how to run it —
// it never fails CI for a missing key. With a key it runs ONE real ClaudeProvider review turn
// and asserts the response is an envelope-shaped JSON object (verdict + 9 verdict_factors).
//
// Run after build:  ANTHROPIC_API_KEY=sk-... node scripts/claude-live-smoke.mjs [model]
// Default model: claude-opus-4-8 (override via argv[2] or [review.claude].model in real use).

import { resolve } from "node:path";

const pkgRoot = resolve(new URL("..", import.meta.url).pathname);

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "[claude-live-smoke] SKIP: ANTHROPIC_API_KEY not set.\n" +
      "  To run the §8.3 ClaudeProvider acceptance smoke:\n" +
      "    cd mcp/codex-review && npm run build && \\\n" +
      "    ANTHROPIC_API_KEY=sk-ant-... node scripts/claude-live-smoke.mjs",
  );
  process.exit(0);
}

const { AnthropicClaudeClient } = await import(`${pkgRoot}/dist/claude-client.js`);
const { ClaudeProvider } = await import(`${pkgRoot}/dist/providers/claude.js`);

const model = process.argv[2] || "claude-opus-4-8";

const REVIEW_PROMPT = `
You are reviewing a trivial no-op code change (a comment-only edit). Output ONLY a single JSON
object (no prose, no markdown fences) matching this envelope schema exactly:

{
  "thread_id": "x", "review_id": "x", "design_id": "smoke", "stage": "code", "review_round": 1,
  "verdict": "Pass",
  "verdict_factors": {
    "critical_count": 0, "important_count": 0, "affected_major_sections_count": 0,
    "has_open_design_decision": false, "has_new_arch_concept": false,
    "has_interdependent_rc": false, "estimated_fix_lines": 0, "touched_module_count": 0,
    "has_design_gap": false
  },
  "conclusions": [], "open_questions": [], "tokens_used_estimate": 0,
  "context_usage_pct": 0.05, "compact_summary_for_round": "trivial no-op; pass",
  "next_action": "ready-to-test", "rejected_by_parser": []
}
`.trim();

async function main() {
  const provider = new ClaudeProvider(
    new AnthropicClaudeClient({ keyEnv: "ANTHROPIC_API_KEY" }),
    { model, maxTokens: 4000, contextWindow: 200000 },
  );
  const session = await provider.openSession("code", "smoke");
  console.log(`[claude-live-smoke] running one real ClaudeProvider turn (model=${model})...`);
  const result = await provider.runTurn(
    { text: REVIEW_PROMPT, workingDirectory: pkgRoot, designId: "smoke", stage: "code", round: 1 },
    session,
  );
  if (result.kind !== "turn") throw new Error(`expected kind:'turn', got ${result.kind}`);

  // Extract the JSON object (tolerate stray whitespace / accidental fences).
  const m = result.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON object in response: ${result.text.slice(0, 200)}`);
  const env = JSON.parse(m[0]);
  const factorKeys = [
    "critical_count", "important_count", "affected_major_sections_count",
    "has_open_design_decision", "has_new_arch_concept", "has_interdependent_rc",
    "estimated_fix_lines", "touched_module_count", "has_design_gap",
  ];
  if (typeof env.verdict !== "string") throw new Error("envelope missing string `verdict`");
  if (!env.verdict_factors || factorKeys.some((k) => !(k in env.verdict_factors))) {
    throw new Error("envelope missing one of the 9 verdict_factors");
  }
  console.log(
    `[claude-live-smoke] PASS: verdict=${env.verdict}, ` +
      `context_usage_pct(estimate)=${result.usage.context_usage_pct?.toFixed(3)}, ` +
      `tokens in/out=${result.usage.input}/${result.usage.output}`,
  );
}

main().catch((err) => {
  console.error(`[claude-live-smoke] FAIL: ${err.message}`);
  process.exit(1);
});
