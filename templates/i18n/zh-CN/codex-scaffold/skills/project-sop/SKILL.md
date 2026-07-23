---
name: project-sop
description: 本仓库的 Codex 侧工作流 skill（ccsop）。当 Codex CLI session 主推任务（design owner）或实现任务（implement owner）、需按项目交付 SOP 与 handoff 流程推进时使用 —— 功能开发、缺陷修复、review 等。
---

# Project SOP Skill（Codex 侧）

ccsop 采纳仓库的 Codex 侧**执行地图**。与其 Claude 侧同胞（`.claude` 插件 skill）一样，它指向规则
真源、**不内嵌规则正文**（单一真源 = `docs/methodology/`，避免漂移）。

设计原则：
1. `docs/methodology/project-delivery-sop.md` 是 SOP 规则的**唯一真源**。
2. `docs/records/current.md` 是活的状态断点 —— 先读它，交接时更新它。
3. 以不产生执行回撤为第一优先级。

## 本 session 是什么角色？（流程矩阵）

读 `.codex-review/config.toml` `[collaboration]`（规则见 `claude-code-sop-collaboration.md §1.D`）：

- `design_owner = "codex"` → **本 CLI 承载主推 session。** Codex 拥有需求澄清、design、任务卡、验收
  编排与 closeout。design pre-review 由**对侧（claude）**执行 —— 若 review 桥已注册进 Codex CLI 的
  MCP 配置则走桥，否则由用户手动转发。
- `implement_owner = "codex"` → **本 CLI 承载 implement 段**（§1.D 规则 3）：implement → 自测 →
  code review（reviewer = 对侧 claude）→ fix 循环 → ready-to-test，然后回报 §6 结构化结果 + 更新
  `current.md`，交回主推 CLI。
- 两键都缺 → legacy 单 driver 模式；此时 Codex session 只按用户显式指令行动（通常作为 reviewer 或
  reviewer-led fallback，§1 模式 3）。
- 绝不自行切流程 / 角色 —— 由用户或配置选定（§1）。

## 执行入口

1. **启动顺序**：读 `docs/records/current.md`（状态 + active 任务 + 锁定决策）；再读本模块专题文档；
   **进 implement / fix 前必须读完整任务卡**（`docs/plans/active/…`）。只在追历史时读 archive。
2. **任务卡**：拆分流程是真接力 —— implement 卡就是跨 CLI 契约（§1.D 规则 3 / §4.1）。不得扩 scope；
   遇阻塞暂停回报，不要绕开即兴发挥。
3. **结构化输出**（§6）：在 implement / fix / 交回时回报 `docsRead / sopChecks / filesInScope /
   filesChanged / testsRun / validationEvidence / handoffUpdated / commit / mode / flow /
   designReview / knownRisks / nextStep`。
4. **closeout 纪律**：closeout 属于 **design owner 的 session**。当那是本 session 时，按 SOP §4.2
   closeout（文档同步 → 单主题 commit → 卡归档 → `code-home:` 行）；否则止步于 ready-to-test + 交回。

## Review 桥（Codex 侧的 auto review）

仓库的 review 桥是 CLI 中立的（stdio MCP）。要在这里用 auto review，把同一个 server +
`--config .codex-review/config.toml` 注册进 Codex CLI 的 MCP 配置（`~/.codex/config.toml
[mcp_servers]`）。桥按 `[collaboration]` 派生每阶段的 reviewer（§1.D —— 对侧模型；fix review 继承
session 的 reviewer）。桥未注册时 review 为手动传递：用户转发 prompt/verdict。

## 规则章节地图

规则在 SOP 文档里 —— 按主题读原文，不在此复制：

| 主题 | 真源 |
|---|---|
| 需求 → 上线流程 / 清单 / 测试 SOP / closeout | `docs/methodology/project-delivery-sop.md` |
| 模式 / 流程矩阵 / 角色 / 评审框架 9.A–9.E / 输出契约 | `docs/methodology/claude-code-sop-collaboration.md` |
| 端到端流程 + 失败模式 + 回滚 | `docs/methodology/workflow-overview.md` |
| 模型分级 | `docs/methodology/model-tier-strategy.md` |
