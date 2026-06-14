# Review (stage=fix)

## 输入（上方已渲染为 drift 前言 + 注入的文件块）

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

## 必需输出（单个 JSON 对象，无散文，无代码围栏）

匹配 ccsop review 桥期望的 envelope schema。

关键规则：
1. `verdict` 必须是以下之一：**`All-fixed` | `Partial` | `New-issues` | `Rereview-after-fixes` | `No-Go`**。
2. `verdict_factors` —— 全部 9 个字段必填。
3. 每个 `conclusion.target` 是 `file_line` 或 `missing_artifact`。
4. 每个 finding 按 `claude-code-sop-collaboration.md §9.D` 分级。

### Envelope schema（精确产出此形状；`thread_id`/`review_id` 由 server 覆盖）
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

## 评审聚焦（对照上一轮的 Critical/Important 验证修复）

对每条 `previous_round_conclusions` 的 Critical/Important：fix diff 是否真的解决了它（而非仅声称）？
fix 是否引入回归或新的 Critical/Important（`New-issues`）？按 §9.E 追踪 carried-over Critical
（被标 resolved 却复现的 finding = stall 信号）。

## Predicate

- `All-fixed`：每条上一轮 Critical/Important 已解，无新增。
- `Partial`：部分已解、部分仍 open（无新 Critical）。
- `New-issues`：fix 引入了新的 Critical/Important。
- `Rereview-after-fixes`：仍 open 的问题需要再走一整轮 review。
- `No-Go`：fix 偏离或更糟。

## 你的任务

把 fix diff 与上一轮 conclusions 对比，如实填充 verdict_factors，现在产出 envelope JSON。
