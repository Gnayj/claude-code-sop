# Review (stage=code)

## Inputs (rendered above as drift preface + injected file blocks)

- design_id: {{design_id}}
- task_card_path: {{task_card_path}}
- handoff_path: {{handoff_path}}
- diff_spec: {{diff_spec}}
- changed_files: {{changed_files}}
- tests_run: {{tests_run}}
- validation_evidence: {{validation_evidence}}
- docs_updated: {{docs_updated}}
- claude_output:
```
{{claude_output_json}}
```
- previous_round_id (if any): {{previous_round_id}}
- previous_round_resolved (if any):
```
{{previous_round_resolved_json}}
```
- applied_fixes (if any):
```
{{applied_fixes_json}}
```

## Required output (single JSON object, no prose, no fence)

Match the envelope schema the ccsop review bridge expects.

Critical rules:
1. `verdict` MUST be one of: **`Pass` | `Pass-after-fixes` | `Rereview-after-fixes` | `No-Go`**.
2. `verdict_factors` — all 9 fields required.
3. Every `conclusion.target` is `file_line` or `missing_artifact`.
4. Grade every finding per `claude-code-sop-collaboration.md §9.D`.

### Envelope schema (emit exactly this shape; `thread_id`/`review_id` are server-overridden)
```json
{
  "thread_id": "x", "review_id": "x", "design_id": "<from input>", "stage": "code",
  "review_round": 1, "verdict": "Pass",
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

## Review order — §9.A → §9.B → §9.C (see claude-code-sop-collaboration.md §9)

§9.A spec compliance (against `task_card_path`):
1. Implemented the right module per design, not surface-only?
2. Test evidence sufficient for "ready to test"?
3. Handoff state consistent with code state?
4. Closeout (if any) only after the user's "test passed"?

§9.B code quality (general — apply the §9.B principles; adapt the concrete check to this project's stack):
logging gated through helpers; no wall-clock where a sim/virtual clock is threaded; cache-layer
consistency with no global flush; optional-dependency nil/None checks; concurrency exit paths +
context plumbing; config over hard-coding; frontend constant reuse / cross-tier permission mirroring;
single-subject conventional-commit.

§9.C module-specific quality (only if this project declared a `9.C.<n>` block for the active module).

## Predicate (§9.D grading + the bridge's verdict predicate)

- `Pass`: critical_count == 0 AND important_count == 0.
- `Pass-after-fixes`: issues exist AND each fix has a file_line/missing_artifact target, touched_module_count ≤ {{code_mechanical_max_modules}}, !new_arch_concept, estimated_fix_lines ≤ {{code_mechanical_max_fix_lines}}, !design_gap.
- `Rereview-after-fixes`: issues exist AND any of: touched_module_count > {{code_mechanical_max_modules}}, new_arch_concept, estimated_fix_lines > {{code_mechanical_max_fix_lines}}, design_gap.
- `No-Go`: implementation diverged from spec.

## Your task

Read the diff, run §9.A → §9.B → §9.C in order, populate verdict_factors honestly, produce the envelope JSON now.
