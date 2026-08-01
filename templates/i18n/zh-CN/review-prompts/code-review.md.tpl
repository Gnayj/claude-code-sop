# Review (stage=code)

## 输入（上方已渲染为 drift 前言 + 注入的文件块）

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

## 必需输出（单个 JSON 对象，无散文，无代码围栏）

匹配 ccsop review 桥期望的 reviewer payload schema。最终 envelope 的 server-owned 字段由桥追加，
不要输出这些字段。

关键规则：
1. `verdict` 必须是以下之一：**`Pass` | `Pass-after-fixes` | `Rereview-after-fixes` | `No-Go`**。
2. `verdict_factors` —— 全部 9 个字段必填。
3. 每个 `conclusion.target` 是 `file_line` 或 `missing_artifact`。
4. 每个 finding 按 `claude-code-sop-collaboration.md §9.D` 分级。

review 桥会在本 prompt 尾部自动追加 `[bridge-authoritative] Reviewer payload contract` 块。
该块与 parser 同源；若与上文冲突，以该块为准，此处不再复制 schema。

## 评审顺序 —— §9.A → §9.B → §9.C（见 claude-code-sop-collaboration.md §9）

§9.A 规范符合（对照 `task_card_path`）：
1. 是否按 design 实现了正确模块，非仅表面？
2. 测试证据是否足以"ready to test"？
3. handoff 状态是否与代码状态一致？
4. closeout（如有）是否只在用户"test passed"后发生？

§9.B 代码质量（通用 —— 套用 §9.B 原则；具体检查适配本项目的栈）：
日志经 helper 收口；threaded 模拟/虚拟时钟处不用 wall-clock；缓存层一致性且无全局 flush；可选依赖
nil/None 检查；并发退出路径 + context 穿透；配置优于硬编码；前端常量复用 / 跨层权限镜像；单主题
conventional-commit。

§9.C 模块特定质量（仅当本项目为 active 模块声明了 `9.C.<n>` 块时）。

## Predicate（§9.D 分级 + 桥的 verdict predicate）

- `Pass`：critical_count == 0 AND important_count == 0。
- `Pass-after-fixes`：有问题 AND 每个 fix 有 file_line/missing_artifact target，touched_module_count ≤ {{code_mechanical_max_modules}}，!new_arch_concept，estimated_fix_lines ≤ {{code_mechanical_max_fix_lines}}，!design_gap。
- `Rereview-after-fixes`：有问题 AND 以下任一：touched_module_count > {{code_mechanical_max_modules}}，new_arch_concept，estimated_fix_lines > {{code_mechanical_max_fix_lines}}，design_gap。
- `No-Go`：实现偏离 spec。

## 你的任务

code diff 按当前 session 的能力交付：若下方出现 `[bridge-provided] Git diff` 块，逐字节评审该块；仅当该块不存在时，才自行读取 `diff_spec` 所指的精确 diff 范围。然后按 §9.A → §9.B → §9.C 顺序跑，如实填充 verdict_factors，现在产出 reviewer payload JSON。
