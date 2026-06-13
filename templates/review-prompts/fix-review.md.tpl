# Review (stage=fix)

## Inputs (rendered above as drift preface + injected file blocks)

- design_id: {{design_id}}
- task_card_path: {{task_card_path}}
- handoff_path: {{handoff_path}}
- fix_diff_spec: {{fix_diff_spec}}
- changed_files: {{changed_files}}
- fix_diff_lines: {{fix_diff_lines}}
- tests_run: {{tests_run}}
- validation_evidence: {{validation_evidence}}
- docs_updated: {{docs_updated}}
- claude_output:
```
{{claude_output_json}}
```
- claude_fix_notes:
```
{{claude_fix_notes_json}}
```
- previous_round_id: {{previous_round_id}}
- previous_round_conclusions:
```
{{previous_round_conclusions_json}}
```

## Required output (single JSON object, no prose, no fence)

Match the envelope schema the ccsop review bridge expects.

Critical rules:
1. `verdict` MUST be one of: **`All-fixed` | `Partial` | `New-issues` | `Rereview-after-fixes` | `No-Go`**.
2. `verdict_factors` — all 9 fields required.
3. Every `conclusion.target` is `file_line` or `missing_artifact`.
4. Grade every finding per `claude-code-sop-collaboration.md §9.D`.

### Envelope schema (emit exactly this shape; `thread_id`/`review_id` are server-overridden)
```json
{
  "thread_id": "x", "review_id": "x", "design_id": "<from input>", "stage": "fix",
  "review_round": 1, "verdict": "All-fixed",
  "verdict_factors": {
    "critical_count": 0, "important_count": 0, "affected_major_sections_count": 0,
    "has_open_design_decision": false, "has_new_arch_concept": false,
    "has_interdependent_rc": false, "estimated_fix_lines": 0, "touched_module_count": 0,
    "has_design_gap": false
  },
  "conclusions": [
    { "conclusion_id": "c_slug", "level": "Critical|Important|Suggestion", "rule": "9.A.1",
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

## Review focus (verify the fixes against the previous round's Critical/Important)

For each `previous_round_conclusions` Critical/Important: is it actually resolved by the fix diff
(not just claimed)? Did the fix introduce a regression or a new Critical/Important (`New-issues`)?
Track carried-over Criticals per §9.E (a finding marked resolved but recurring = a stall signal).

## Predicate

- `All-fixed`: every previous Critical/Important resolved, no new ones.
- `Partial`: some resolved, some still open (no new Criticals).
- `New-issues`: the fix introduced a new Critical/Important.
- `Rereview-after-fixes`: still-open issues need another full review pass.
- `No-Go`: the fix diverged or made it worse.

## Your task

Compare the fix diff against the previous conclusions, populate verdict_factors honestly, produce the envelope JSON now.
