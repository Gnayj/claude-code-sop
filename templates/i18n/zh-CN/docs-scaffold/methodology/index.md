# 方法论索引

ccsop 交付方法论（ccsop canonical；`owner=ccsop`，经 `/sop-update` 更新）。按主题阅读：

| 文档 | 涵盖内容 |
|---|---|
| [`project-delivery-sop.md`](project-delivery-sop.md) | 交付 SOP：原则、文档结构、需求→发版流程、功能清单、测试 SOP（增量日志窗口 / 两次请求法 / 禁全局 flush）、提交与发版、Bug SOP、Spike SOP、closeout 自审。规则单一真源。 |
| [`claude-code-sop-collaboration.md`](claude-code-sop-collaboration.md) | 协作协议：3 种模式（driver-led + reviewer 闸门 / + 自动 review / reviewer-led fallback）、角色、强制输入、任务卡约定、§4.5 design-pre-review 触发、§4.6 合并确认点、§4.7 worktree、§6 输出契约、§9.A–§9.E 评审框架、§10.A subagent 卸载。 |
| [`workflow-overview.md`](workflow-overview.md) | 端到端流程图、各阶段产物、失败模式、回滚 playbook。 |
| [`model-tier-strategy.md`](model-tier-strategy.md) | 哪个阶段用哪档模型（判断用强档、机械用省档、扇出用 fresh-context、评审用 independent）+ agent-in-cron 边界。 |

session 启动时跑 `/handoff`（或读 `../records/current.md`）；`project-sop` skill 是指向这里的执行地图。
