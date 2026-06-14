# 模型分级策略

> ccsop canonical（英文原版的中文维护版）。把原本散落在协作协议（§10 / §10.A）和各 agent
> `model:` frontmatter 里的模型分级显式化。原则：**让模型能力匹配任务的推理需求** —— 判断与
> 深度工作用强模型，机械执行用省档，扇出用 fresh-context subagent，评审用 independent（最好异构）模型。

## 1. 按阶段分级

| 阶段 / 工作 | 档位 | 理由 |
|---|---|---|
| 设计 / 深度 implement / fix 判断（主会话） | **最强模型 + max effort**（默认） | 跨步连贯推理、架构、权衡 —— 质量在此处复利。 |
| 机械执行：verify 采证、文档同步、按 runbook 部署 | **更省的"降档"subagent**（如 `sonnet`） | 契约是"照步骤做、逐字记录、不解读"；解读留在主（强）会话。即 `verify-runner` / `doc-sync` / `deploy-runner` agent。 |
| 扇出搜索 / 一次性大 token"压成几行" | **fresh-context subagent**（`Explore` / `general-purpose`） | 返回结论而非文件转储；保持主窗口干净。判据见协作协议 §10.A。 |
| 评审（design / code / fix） | **由 `review.provider` 选定的模型/实例** | 优先异构（默认 `codex`）：独立模型能抓到 driver 自己模型看不见的盲区。`claude` provider 丢失这种异构性 —— 见其 caveat。 |

## 2. 成本 / 限速降档

implement / 深度工作默认用**最强模型 + max effort**。**仅**在成本或限速压力下才降模型或 effort
—— 并在该轮 notes 里写明。不要静默降判断档；判断任务上用弱模型是假节省，会以返工形式暴露。

## 3. 机械档契约（为何这里用更省的档是安全的）

降档之所以安全，正因为这些 agent 被约束为*不做判断*：
- `verify-runner` 逐字采证，不裁定 PASS/FAIL。
- `doc-sync` 把已确认事实写进指定小节，不杜撰。
- `deploy-runner` 按 runbook 逐步执行、遇任何异常即停。

强主会话搭好任务、给出预期、解读结果。若某任务中途需要解读，它就不该放在机械档。

## 4. cron 里的 agent —— 边界

把分级 agent 复用到定时（cron）任务有边界，且很容易过度泛化：

- **不要把监控 / 判断型 agent 放进 cron。** 一个自身可能不可靠（模型抖动、限速、解析失败）的监控
  器，作为看门狗是自相矛盾的。无人值守的周期检查，用确定性的 **shell sentinel**（带显式阈值 +
  告警的 bash 脚本），而非 LLM agent。
- **可降级的批处理可以跑在 cron** —— 即漏跑或降级一次可容忍、下一轮自我纠正、且不需实时判断的工作。
- **不要把这条过度泛化成"永远别把 agent 放进 cron"。** 这条规则针对的是*监控 / 判断*位置，而非
  所有定时工作。

## 5. 落地

本文档与各 agent 的 `model:`（及 `effort:`）frontmatter 互为印证：这里的表格陈述策略；agent
frontmatter（`agents/*.md`）是它按 agent 落地之处。策略变化时两边都要更新 —— 更好的是，让每个
agent 的 `model:` 与本文档赋予该 agent 角色的档位保持一致。
