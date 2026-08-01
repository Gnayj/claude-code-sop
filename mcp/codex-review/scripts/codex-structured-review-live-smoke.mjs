#!/usr/bin/env node
// Gated release smoke for the exact, generated richest-stage Codex review outputSchema.
//
// Run:
//   RUN_CODEX_STRUCTURED_SMOKE=1 npm run smoke:codex-structured
// Optional:
//   CCSOP_CODEX_SMOKE_MODEL=<model> (default: gpt-5.5)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.RUN_CODEX_STRUCTURED_SMOKE !== "1") {
  console.log(
    "[codex-structured-review-live-smoke] SKIP: set RUN_CODEX_STRUCTURED_SMOKE=1 for the release gate.",
  );
  process.exit(0);
}

const pkgRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(pkgRoot, "../..");
const sdkSpec = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"))
  .dependencies["@openai/codex-sdk"];
let pathCliVersion = "unavailable";
try {
  pathCliVersion = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
} catch {
  // The bridge may still resolve the packaged CLI. Provenance below is authoritative for the turn.
}

const { OpenAICodexClient } = await import(`${pkgRoot}/dist/codex-client.js`);
const { CodexProvider } = await import(`${pkgRoot}/dist/providers/codex.js`);
const { ReviewStructuredPayload } = await import(`${pkgRoot}/dist/types.js`);

const model = process.env.CCSOP_CODEX_SMOKE_MODEL || "gpt-5.5";
const prompt = `
Return a review payload for a trivial fix that is fully correct. Output only the JSON object
required by your structured response format. Use verdict "All-fixed", all five numeric factors
as 0, all four boolean factors as false, no conclusions, no open questions,
context_usage_pct 0, compact_summary_for_round "structured schema live smoke passed", and
next_action "ready-to-test". Do not emit runtime or audit envelope fields.
`.trim();

async function main() {
  const client = new OpenAICodexClient({ defaultModel: model, defaultEffort: "low" });
  const provider = new CodexProvider(client, { workingDirectory: repoRoot, model, effort: "low" });
  const session = await provider.openSession("fix", "structured-schema-live-smoke");
  try {
    console.log(
      `[codex-structured-review-live-smoke] dispatching exact fix-stage schema ` +
        `(model=${model}, sdk_spec=${sdkSpec}, PATH=${pathCliVersion})...`,
    );
    const result = await provider.runTurn(
      {
        text: prompt,
        workingDirectory: repoRoot,
        designId: "structured-schema-live-smoke",
        stage: "fix",
        round: 1,
      },
      session,
    );
    if (result.kind !== "turn") throw new Error(`expected kind=turn, got ${result.kind}`);
    const fallbackWarning = result.warnings?.find((warning) =>
      warning.includes("outputSchema capability unavailable"),
    );
    if (fallbackWarning) throw new Error(`structured-output fallback fired: ${fallbackWarning}`);

    const decoded = JSON.parse(result.text);
    const parsed = ReviewStructuredPayload.safeParse(decoded);
    if (!parsed.success) {
      throw new Error(`response failed ReviewStructuredPayload: ${parsed.error.message}`);
    }
    if (parsed.data.verdict !== "All-fixed") {
      throw new Error(`unexpected fix verdict ${parsed.data.verdict}`);
    }
    const provenance = client.getProvenance();
    console.log(
      `[codex-structured-review-live-smoke] PASS: exact generated schema accepted; ` +
        `fallback=false; conclusions=${parsed.data.conclusions.length}; ` +
        `thread=${result.provider_session_id}; binary_source=${provenance?.source ?? "unknown"}`,
    );
  } finally {
    provider.closeSession(session);
  }
}

main().catch((error) => {
  console.error(`[codex-structured-review-live-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
