# 工作流总览 — driver-led + reviewer

> `driver-led + auto review` 流程的端到端总览，整合 SOP、协作协议、review-bridge 设计。**无新
> 规则** —— 仅整合 + 速查。"Driver" = 实施 agent；"reviewer" = `review.provider` 选定者。

## 1. 协作模式（速查）

两种在用模式（见 `claude-code-sop-collaboration.md §1`）：

| 模式 | review 通信 | implement / closeout | 何时 |
|---|---|---|---|
| **`driver-led + auto review`**（桥接好时默认） | MCP 自动调起 reviewer（`codex_design_review` / `codex_code_review` / `codex_fix_review`） | driver implement + closeout | 日常迭代 |
| `driver-led + reviewer gate` | 用户**手动**转发 diff / verdict（或 `review.provider=manual`） | driver implement + closeout | 桥宕机，或想手动控制 |
| `reviewer-led closed loop`（fallback，休眠） | 用户/自动化转发 | reviewer 拥有 design + 验收 + closeout；driver 只 implement | 想让 reviewer 拥有 design/验收（见协作协议 §1 模式 3 / §8.1） |

## 2. 端到端流程

```
(1) 需求澄清
    Driver 主导；SOP §4 "分块确认"；用户给出业务目标 + 验收信号
        ↓
(2) 设计
    Driver 写 design.md；若用户答了 Q1-QN 则锁定决策
    产出：docs/methodology/<id>-design.md  或  docs/design/<module>/...
        ↓
   命中 §4.5 触发？ ── 否 ──→ 跳过 design review
        │ 是
        ↓
(3) codex_design_review（自动）   verdict ∈ {Go, Go-after-fixes, Rereview-after-fixes, No-Go}
        Go / Go-after-fixes      → 机械修复 → implement
        Rereview-after-fixes     → 修复 → 复审
        No-Go                    → 停，报告用户，重新设计
        ↓
(4) Implement   从 main 切 feature 分支（branch = design-id 或自定义）
    N=1 单轮：无 implement card；N≥2：每阶段一张 card
    每个 commit 单主题
        ↓
(5) /simplify 提测前预筛  (SOP §5.A：代码后缀 allowlist + ≥30 add+del 行)
    TRIGGER → 跑 /simplify → 自修 → 重跑至干净
    EXEMPT / 不可用 → 跳过 + 记录理由（非阻塞）
        ↓
(6) 自测（driver）   build / test / 增量日志窗口 / verify 脚本 (SOP §6.4)
        ↓
(7) codex_code_review（自动）   verdict ∈ {Pass, Pass-after-fixes, Rereview-after-fixes, No-Go}
        Pass / Pass-after-fixes  → 机械修复 → "可提测"
        Rereview-after-fixes     → 修复 → 复审（超轮次上限后断路器触发）
        No-Go                    → 停，报告用户
        ↓
(8) 用户验收   用户跑 verify 命令，回 "test passed" / "failed: X"
        "test passed" → Closeout      "failed" → 仍在 implement；修复 → 重测
        ↓
(9) Closeout（driver，单 commit）   handoff closeout + 任务卡归档 + code-home: 行
    N=1：把 closeout 摘要追加到 design.md implementation-record 小节
    N≥2：把每阶段 implement card 归档到 docs/plans/completed/<module>/
        ↓
(10) 合并 main（协作协议 §4.6，4 确认点）
    push feature → ff-only 合 main → push main → 删远端 feature；每步分别确认
```

## 3. 各阶段产物

| 阶段 | 产物 | 路径 |
|---|---|---|
| (2) 设计 | `<design-id>-design.md` | `docs/methodology/`（方法论）/ `docs/design/<module>/`（功能） |
| (3) design review | review envelope | 桥状态；design.md 顶部记录 review chain（Round N verdict + finding ids） |
| (4) Implement | 从 main 切 feature 分支 | `<design-id>` 或自定义 |
| (4) Implement card | 多轮时每阶段一张 | `docs/plans/active/<design-id>-<phase>-implement.txt`（单轮：无） |
| (5) /simplify | 自测证据 | implement commit / verify 证据记录 TRIGGER/EXEMPT + 理由 |
| (6) 自测 | verify 脚本 / 接口结果 | `scripts/verify_*.sh`（运行时功能）+ 增量日志 |
| (7) code review | review envelope | 桥状态；closeout commit 引用 review chain |
| (8) 用户验收 | "test passed" / "failed: X" | 用户回复 |
| (9) Closeout | closeout commit + 归档 | N=1：design implementation-record；N≥2：implement card + `completed/<module>/` |
| (9) `code-home:` | 单行 key:value | design 文档末尾，或 implement card 末尾 |
| (10) 合并 | ff-only 合并 + push main | `code-home:` 回填 sha |

## 4. 单 design.md vs design+implement 双卡

- **单 design.md（默认）：** 一份 `<id>-design.md` 既是设计也是该轮契约；implement card 仅用于
  多轮 / 多人接力。适配自动 review（无需 card 作接力）。
- **双卡（legacy）：** 分开的 design + implement card；适配 reviewer-led 拆分流程。

决策矩阵（同 `collaboration §4.1`）：

| design scope 阶段数 | implement card |
|---|---|
| N=1 单轮 | 无；closeout 摘要 → design implementation-record |
| N≥2 独立 closeout 阶段 | 每阶段一张（从 `_template-implement.txt`） |
| N=1 中途暂停 / 接力 | 一张 card，在阶段切换处创建 |

## 5. 流程中的 /handoff 与 /simplify

| skill | 阶段 | 触发 | 产出 / 行为 |
|---|---|---|---|
| `/handoff` | (1) 之前 / session 启动 / 切换 active 任务 | 用户说 "按 SOP 推进 / 现状如何 / 继续 <task>" | ~150 行结构化 handoff（模式 + active 任务 + scope + 非目标 + 验收 + review 状态 + 锁定决策 + 协作边界 + 下一步） |
| `/simplify`（内置） | (5) implement 后、自测前 | 改动后缀在代码 allowlist 内 且 ≥30 add+del 行 | 报告问题或无；driver 自修；不替代 reviewer |

## 6. 失败模式

| 症状 | 处理 | 出处 |
|---|---|---|
| `codex_code_review = No-Go` | 停；报告用户；不自动重启循环 | collaboration §3 |
| `codex_code_review` 反复 `Rereview-after-fixes` 超上限 | 断路器触发；停，报告 | 桥设计（breakers） |
| `codex_design_review = No-Go` | 重新设计；不进 implement | collaboration §4.5 |
| `/simplify` 误报 | inline note + 证据 "non-issue: <reason>"；继续到 reviewer（其仍可否决） | SOP §5.A |
| 用户验收 "failed: X" | 未 closeout；修复 → 重自测 → 重测；无 closeout commit | SOP §6.3 |
| build / test 失败 | implement 内正常修复；别报 "可提测" | SOP §5 |
| 桥 / provider 不可用 | 降级为手动转发；记录理由；不自动重启自动通道 | collaboration §3 |
| §4.5 触发不明 | 默认走 pre-review | collaboration §4.5 |
| ff-only 合并失败（已分叉） | 暂停；别自行 rebase；报告用户 | collaboration §4.6 |
| session 阻塞（fix 循环卡住 / 等用户） | 起 git worktree，另开 session 做别的活 | collaboration §4.7 |
| `/handoff` 漏关键信息 | 调用后再 Read 完整任务卡 / design 文档 | collaboration §4 |
| `/simplify` 不可用 | 跳过 + 记录理由；非阻塞 | SOP §5.A |
| fix 循环不收敛（同一 Critical 复现 / Critical 总数 2 轮持平 / 回归 ping-pong） | 标记 stall；停；报告分歧 + ≥2 选项；在软上限处升级 | collaboration §9.E |
| 试验/诊断补丁留在主代码 | 探针放进一次性脚本 + 三态 verdict；临时主代码改动登记，closeout 时清理或固化 | SOP §13 + §14 |

## 7. 回滚 playbook（按已到达的点）

| 状态 | 回滚 | 风险 |
|---|---|---|
| 本地工作树，未提交 | `git checkout -- <file>` / 重编辑 | 无 —— 可逆 |
| 已提交，未推送 | `git reset --hard HEAD~N` | **破坏性 —— 单独征求用户确认**（SOP §4.1） |
| 已推送 feature 分支（未合并） | `git revert <sha>` + push，或删远端分支（用户授权） | 非改写 |
| ff-only 已合 main、main 未推 | `git reset --hard <pre-merge-sha>` | **破坏性 —— 单独征求用户确认** |
| 已推 main | `git revert <sha>` + push 新 commit；**不 force-push** | force-push 禁止 |
| 已部署到生产 | 部署旧 binary + `git revert` + 新 commit（见 `docs/runbooks/`）；**先报告用户** | 高风险；不自动允许 |
| closeout 后发现设计错误（非 bug） | revert closeout commit + 把 design 拉回 draft + 修复 + 重跑 design review | 罕见；reviewer 本应抓到 |

## 8. 参考

- 模式 + 角色 + 强制输入：`claude-code-sop-collaboration.md §1 / §2 / §4`
- 任务卡约定：`claude-code-sop-collaboration.md §4.1`
- §4.5 design pre-review 触发 / §4.6 合并确认点 / §4.7 worktree：`claude-code-sop-collaboration.md`
- 评审框架 + 收敛 + subagent 卸载：`claude-code-sop-collaboration.md §9 / §10.A`
- 功能清单 + 测试 SOP + Bug SOP + Spike + closeout 自审 + 依赖合法性：`project-delivery-sop.md §5/§6/§12/§13/§14/§9`
- 模型分级：`model-tier-strategy.md`
- review 桥（envelope schema / verdict_factors）：ccsop review MCP（`mcp/codex-review`）
