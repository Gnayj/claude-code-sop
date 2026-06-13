# Review (stage=design)

## Inputs (rendered above as drift preface + injected file blocks)

- design_id: {{design_id}}
- task_card_path: {{task_card_path}}
- handoff_path: {{handoff_path}}
- triggers_hit: {{triggers_hit}}
- previous_round_id (if any): {{previous_round_id}}
- previous_round_resolved (if any):
```
{{previous_round_resolved_json}}
```
- applied_edits (if any):
```
{{applied_edits_json}}
```

## Required output (single JSON object, no prose, no fence)

Match the envelope schema the ccsop review bridge expects.

Critical rules:
1. `verdict` MUST be one of: **`Go` | `Go-after-fixes` | `Rereview-after-fixes` | `No-Go`** (NOT `Pass` — that is the code stage).
2. `verdict_factors` — all 9 fields required.
3. Every `conclusion.target` is `file_line` or `missing_artifact`.
4. Grade every finding per `claude-code-sop-collaboration.md §9.D`.

### Envelope schema (emit exactly this shape; `thread_id`/`review_id` are server-overridden)
```json
{
  "thread_id": "x", "review_id": "x", "design_id": "<from input>", "stage": "design",
  "review_round": 1, "verdict": "Go",
  "verdict_factors": {
    "critical_count": 0, "important_count": 0, "affected_major_sections_count": 0,
    "has_open_design_decision": false, "has_new_arch_concept": false,
    "has_interdependent_rc": false, "estimated_fix_lines": 0, "touched_module_count": 0,
    "has_design_gap": false
  },
  "conclusions": [
    { "conclusion_id": "c_slug", "level": "Critical|Important|Suggestion", "rule": "4.5",
      "target": { "kind": "file_line", "file": "path", "line": 42,
                  "missing_artifact_kind": null, "missing_artifact_path": null },
      "evidence": "...", "fix": "...",
      "auto_fix_class": "auto|manual-only|deferred-to-next-round|rejected-by-parser" }
  ],
  "open_questions": [], "tokens_used_estimate": 0, "context_usage_pct": 0.1,
  "compact_summary_for_round": "<= 2000 chars",
  "next_action": "fix-required|ready-to-implement|ready-to-test|blocked",
  "rejected_by_parser": []
}
```
Alternate target shape (missing artifact): `{ "kind":"missing_artifact", "file":null, "line":null, "missing_artifact_kind":"test|config|doc|module", "missing_artifact_path":"path" }`.

## Review focus (design pre-review — `claude-code-sop-collaboration.md §4.5`)

Check the design against the triggers that fired ({{triggers_hit}}):
1. Is the scope / non-goals / acceptance crisp and internally consistent?
2. Are external-interface / schema / permission / deploy / data-migration changes safe and reversible?
3. Are the locked decisions (Q1-QN) coherent, and is anything left as an unresolved open question?
4. Net-new abstractions / cross-cutting consistency / rollback plan present?

## Predicate

- `Go`: no Critical, no unresolved open design decision.
- `Go-after-fixes`: issues exist but all mechanically fixable (affected_major_sections_count ≤ {{design_mechanical_max_sections}}, !new_arch_concept, !interdependent_rc, !open_design_decision).
- `Rereview-after-fixes`: issues exist AND any of those mechanical bounds exceeded.
- `No-Go`: the design is structurally wrong; redesign.

## Your task

Read the design doc + task card, evaluate against §4.5 triggers, populate verdict_factors honestly, produce the envelope JSON now.
