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

The review bridge automatically appends a `[bridge-authoritative] Envelope contract` block at the end of this prompt.
That block shares its source with the parser and is authoritative if anything above conflicts; the schema is not duplicated here.

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

The fix diff is delivered per your session's capability: if a `[bridge-provided] Git diff` block appears below, review it byte-for-byte against the previous conclusions; only when it is absent, read the exact fix diff range identified by `fix_diff_spec` yourself. Populate verdict_factors honestly and produce the envelope JSON now.
