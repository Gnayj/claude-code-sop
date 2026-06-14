# Review (stage=design)

## 输入（上方已渲染为 drift 前言 + 注入的文件块）

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

## 必需输出（单个 JSON 对象，无散文，无代码围栏）

匹配 ccsop review 桥期望的 envelope schema。

关键规则：
1. `verdict` 必须是以下之一：**`Go` | `Go-after-fixes` | `Rereview-after-fixes` | `No-Go`**（不是 `Pass` —— 那是 code 阶段）。
2. `verdict_factors` —— 全部 9 个字段必填。
3. 每个 `conclusion.target` 是 `file_line` 或 `missing_artifact`。
4. 每个 finding 按 `claude-code-sop-collaboration.md §9.D` 分级。

### Envelope schema（精确产出此形状；`thread_id`/`review_id` 由 server 覆盖）
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

## 评审聚焦（design pre-review —— `claude-code-sop-collaboration.md §4.5`）

对照触发的 triggers（{{triggers_hit}}）检查 design：
1. scope / 非目标 / 验收 是否清晰且内部一致？
2. 外部接口 / schema / 权限 / 部署 / 数据迁移 改动是否安全且可逆？
3. 锁定决策（Q1-QN）是否自洽，是否有遗留的 unresolved open question？
4. 是否有 net-new 抽象 / 跨切面一致性 / 回滚方案？

## Predicate

- `Go`：无 Critical，无 unresolved open design decision。
- `Go-after-fixes`：有问题但全部可机械修复（affected_major_sections_count ≤ {{design_mechanical_max_sections}}，!new_arch_concept，!interdependent_rc，!open_design_decision）。
- `Rereview-after-fixes`：有问题 且 上述任一机械边界被突破。
- `No-Go`：design 结构性错误；重新设计。

## 你的任务

读 design 文档 + 任务卡，对照 §4.5 triggers 评估，如实填充 verdict_factors，现在产出 envelope JSON。
