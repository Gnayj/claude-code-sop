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

匹配 ccsop review 桥期望的 reviewer payload schema。最终 envelope 的 server-owned 字段由桥追加，
不要输出这些字段。

关键规则：
1. `verdict` 必须是以下之一：**`All-fixed` | `Partial` | `New-issues` | `Rereview-after-fixes` | `No-Go`**。
2. `verdict_factors` —— 全部 9 个字段必填。
3. 每个 `conclusion.target` 是 `file_line` 或 `missing_artifact`。
4. 每个 finding 按 `claude-code-sop-collaboration.md §9.D` 分级。

review 桥会在本 prompt 尾部自动追加 `[bridge-authoritative] Reviewer payload contract` 块。
该块与 parser 同源；若与上文冲突，以该块为准，此处不再复制 schema。

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

fix diff 按当前 session 的能力交付：若下方出现 `[bridge-provided] Git diff` 块，逐字节评审该块并与上一轮 conclusions 对比；仅当该块不存在时，才自行读取 `fix_diff_spec` 所指的精确 fix diff 范围。如实填充 verdict_factors，现在产出 reviewer payload JSON。
