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

Match the reviewer payload schema the ccsop review bridge expects. Server-owned final-envelope
fields are appended by the bridge; do not emit them.

Critical rules:
1. `verdict` MUST be one of: **`Pass` | `Pass-after-fixes` | `Rereview-after-fixes` | `No-Go`**.
2. `verdict_factors` — all 9 fields required.
3. Every `conclusion.target` is `file_line` or `missing_artifact`.
4. Grade every finding per `claude-code-sop-collaboration.md §9.D`.

The review bridge automatically appends a `[bridge-authoritative] Reviewer payload contract` block at the end of this prompt.
That block shares its source with the parser and is authoritative if anything above conflicts; the schema is not duplicated here.

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

The code diff is delivered per your session's capability: if a `[bridge-provided] Git diff` block appears below, review it byte-for-byte; only when it is absent, read the exact diff range identified by `diff_spec` yourself. Then run §9.A → §9.B → §9.C in order, populate verdict_factors honestly, and produce the reviewer payload JSON now.
