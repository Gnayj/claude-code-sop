// ReviewProvider abstraction — the "raw turn" boundary (design §4.7, Q2/Q5/Q7/Q10).
//
// A ReviewProvider knows ONLY how to obtain one raw turn of review text (+ usage +
// a resumable session handle). It does NOT parse, does NOT decide verdicts, does NOT
// own orchestration state. The orchestrator (run-review-flow) keeps: output-parser,
// server-authoritative review_id/thread_id override, usage accounting, context_usage_pct
// / force_new_thread decisions, drift, circuit-breakers, envelope assembly + schema check.
//
// Provider boundary = raw turn, NOT a parsed envelope (codex r1 C1). Manual two-phase
// (codex r2 C2): a `runTurn` may return `awaiting_manual` instead of a turn — that branch
// is a CONTROL result the orchestrator returns as-is, never fed to the parser/breaker/usage.
export {};
//# sourceMappingURL=review-provider.js.map