// ManualProvider — human / external review, two-phase non-blocking (design §4.7, C2 / Q10).
//
// PREPARE (no verdict yet): write the rendered prompt to
//   <sessions_dir>/<design_id>.<stage>.r<round>.prompt.md
// and return { kind:"awaiting_manual", prompt_path, verdict_path_expected }. The orchestrator
// returns this verbatim WITHOUT parsing — MCP replies "awaiting", so the call never blocks
// waiting for a human.
//
// SUBMIT / one-shot (verdict present): the caller re-invokes with manual_verdict_path (or the
// expected verdict file already exists). The provider reads that file and returns it as a
// normal kind:"turn"; the orchestrator parses it through the SAME output-parser + envelope as
// every other provider. submit is idempotent: the same verdict file -> the same parsed result.
//
// Concurrency: the orchestrator holds the per-design_id advisory lock around the whole flow,
// so manual prepare/submit for one design_id are already serialized — no extra verdict file
// lock is needed here. Zero external dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
function sanitizeId(id) {
    return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
export class ManualProvider {
    opts;
    kind = "manual";
    constructor(opts) {
        this.opts = opts;
    }
    async openSession(stage, designId, _prior) {
        return {
            kind: "manual",
            designId,
            stage,
            externalSessionId: `manual:${designId}:${stage}`,
        };
    }
    async runTurn(input, session) {
        const base = `${sanitizeId(input.designId)}.${input.stage}.r${input.round}`;
        const promptPath = join(this.opts.sessionsDir, `${base}.prompt.md`);
        const verdictPathExpected = join(this.opts.sessionsDir, `${base}.verdict.json`);
        const verdictPath = input.manualVerdictPath ?? verdictPathExpected;
        // SUBMIT / one-shot: a verdict is available -> ingest it as a normal turn.
        if (existsSync(verdictPath)) {
            const text = readFileSync(verdictPath, "utf8");
            return {
                kind: "turn",
                text,
                usage: { input: null, output: null, total: null },
                provider_session_id: session.externalSessionId,
            };
        }
        // PREPARE: write the prompt for a human / external reviewer; do not block.
        mkdirSync(this.opts.sessionsDir, { recursive: true });
        writeFileSync(promptPath, input.text, "utf8");
        return {
            kind: "awaiting_manual",
            prompt_path: promptPath,
            verdict_path_expected: verdictPathExpected,
        };
    }
    closeSession(_session) {
        // Files persist by design; nothing in-memory to release.
    }
}
//# sourceMappingURL=manual.js.map