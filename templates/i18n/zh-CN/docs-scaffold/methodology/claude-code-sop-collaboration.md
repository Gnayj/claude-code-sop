# 协作协议（driver + reviewer）

> ccsop canonical（英文原版的中文维护版）。与 `project-delivery-sop.md` 和 `workflow-overview.md`
> 配套。"driver" 是拥有主推 session 的 agent（见 §1.D —— 其 CLI 即 design 方的 CLI）；每个阶段的
> "reviewer" 是**该阶段 owner 的对侧模型**（派生 —— 见 §1.D），经 review 桥或按 §1 手动传递。
> 本协议把一套久经实战的工作流通用化；它保留规则，只把项目锚点换成 `${...}`。

## 1. 模式

三种协作模式；前两种是 **driver-led**（默认形态），仅在 review 如何传递上不同，第三种是
**reviewer-led** fallback：

1. **`driver-led + reviewer gate`（默认）。** driver 做澄清、设计、任务卡、implement、fix、closeout。
   reviewer 做 **code review**（以及 §4.5 触发时的 design pre-review）。当 `review.provider = manual`
   时，review 通信由用户转发（driver 写 prompt，人/外部 reviewer 回 verdict）。
2. **`driver-led + auto review`。** 当 `review.provider ∈ {codex, claude}` 且 review MCP 桥接好时，
   driver 在 §4.5 / implement / fix 节点自动调 `codex_design_review` / `codex_code_review` /
   `codex_fix_review` —— 无需手动转发。driver 随后机械执行 verdict（见 §3 verdict 矩阵）。仅在断路器
   或 `No-Go` 时打断用户。
3. **`reviewer-led closed loop`（fallback，默认休眠）。** 角色反转：reviewer 拥有 设计、任务卡、
   review、验收，并可执行 closeout；driver 实现 代码 + 测试脚本 并回结构化结果（§6）。通信由用户或
   项目特定自动化转发（自动化本身**不**属于 ccsop —— 想全自动请自备）。当你想让更强/独立的模型拥有
   设计与验收、driver 当纯实现者时用它。其循环见 §8.1。

所有模式都遵守 `project-delivery-sop.md` 且必须闭合完整循环
（design → implement → test → review → fix → closeout）；只做中间一段不算"完成"。
**模式——以及 §1.D 流程——都显式选择** —— 由用户（显式切换指令）或项目配置；driver 和 reviewer 都不
自行切模式或流程。切到 auto review 需要桥通过其自测（`verify-mcp`）；桥/provider 失败时 auto review
降级到模式 1 且不自动恢复。

## 1.A 自治档位（与模式正交）

driver-led 模式上的第三根轴（不改角色，故非第 4 模式）：
- **`gated`（默认）** —— 用户确认设计（§4 分块确认）、给"test passed"（`project-delivery-sop.md §6.2`）、确认每个 §4.6 合并点。
- **`full-auto`** —— driver 自动推进**常规**闸：设计签字走自查的 §4 契约 + §3 auto-review 循环；验收走**合法范围内**的自验（§1.C）；本地 closeout + 本地 `git merge --ff-only` 合 main（§4.2/§4.6）。整跑以一份 **run 报告**（§6.A）收尾。driver **只在升级谓词（§1.B）触发时跳出循环、把控制交还用户。**

在 `.codex-review/config.toml` `[collaboration] autonomy = "gated" | "full-auto"` 设（operational key；review 桥忽略它；缺/非法值 **fail-closed 到 `gated`**）。显式用户指令（"full-auto" / "一杆推到底" / "gated this one"）可按 session 覆盖。full-auto **绝不**放松 §1.B 的 never-auto 类。

## 1.B 升级谓词（full-auto 当且仅当以下任一成立时停下交用户）

full-auto 无人值守运行，**除非**以下任一成立 —— 则停下、报告、并给 ≥1 推荐选项：
1. **永远确认（`project-delivery-sop.md §4.1`）** —— 破坏性/不可逆操作、生产配置或服务改动、不可逆 DDL/DML、部署/重启/清空。（never auto）
2. **Exfil-class** —— 把私有内容发往外部服务（如 private→public push）。（never auto）
3. **远端外化（§4.6）** —— push 到远端、删远端分支、发布/发版（本地 closeout + 本地 ff-only 合 main 自动；**所有远端**动作升级）。（never auto）
4. **只有用户能下的品味/领域/验收判断** —— 主观质量（散文/翻译/UX）、真实环境或生产验收、业务优先级、"这个能接受吗"类闸。
5. **不可解的歧义** —— scope/需求确实欠定且无法从上下文、代码库、reviewer 解出。（能用合理默认或 reviewer 解的选择**不是**升级 —— 决定、记录、继续。）
6. **Stall（§9.E）** —— fix 循环不收敛（同一 Critical 连 2 轮 / Critical 总数连 2 轮不降 / 修复 ping-pong 回归）→ 带 ≥2 选项升级。
7. **Review `No-Go` / 断路器** —— design 或 code review `No-Go`，或断路器触发。
8. **技术分叉 → 先交 reviewer** —— 无明确默认的*技术*设计分叉交 `codex_design_review`（不交用户）；只有*偏好/业务*分叉交用户。
9. **执行阻塞** —— 缺 credential/key、平台权限拒绝、sandbox/网络/依赖约束、所需工具不可用、或**所需验证根本跑不了**。带失败命令 + 证据升级；**绝不自验一个没真跑的检查。**

## 1.C 自验边界 + 早期抽样 checkpoint

- **自验可顶替**用户"test passed"，**仅当**验收是**机器可验**的：build/编译、自动化测试、grep/schema/drift-gate 不变式、对照 design 的 spec 符合性。
- **自验不可顶替**（→ 按 §1.B.4/§1.B.9 升级）：主观质量、真实环境/生产验收、任何需要外部观测或领域/业务判断的东西。
- **早期抽样 checkpoint（防"高效地跑偏"）：** 对**品味/风格重**或**大批量**产物，full-auto 先产一小份**代表性样本**、在批量生产**之前**给用户 checkpoint —— 别在未确认的风格/契约上生成整批。

## 1.D 流程矩阵（谁 design × 谁 implement —— 与 §1 模式和 §1.A 正交）

第四根轴。"driver" 分解为两个**阶段 owner** —— `design_owner` 与 `implement_owner`，各取 `claude`
或 `codex` —— 得到 **4 个可切换流程**（命名 `<design_owner>+<implement_owner>`）：

| 流程 | design | design review | implement | code review | 主推 CLI |
|---|---|---|---|---|---|
| `claude+claude`（默认） | claude | codex | claude | codex | Claude Code |
| `claude+codex` | claude | codex | codex | claude | Claude Code |
| `codex+codex` | codex | claude | codex | claude | Codex |
| `codex+claude` | codex | claude | claude | codex | Codex |

规则：
1. **reviewer 派生、不可配**：每个阶段的 reviewer 恒为**该阶段 owner 的对侧模型**（design review ←
   counterpart(design_owner)；code review ← counterpart(implement_owner)；fix review 由提出 findings
   的 reviewer 复判）。因此 self-review *不可表达*，而不只是被禁止。
2. **主推 session 落在 design_owner 的 CLI**（"哪个模型 design，就进哪个 CLI 推"）。designer(-driver)
   拥有需求澄清、design、任务卡、验收编排与 closeout；implementer 拥有 implement + 自测 + fix 并回
   §6 结构化结果。两 owner 重合时，即本协议其它地方描述的单 driver 行为。
3. **拆分流程**（`design_owner ≠ implement_owner`）是真接力：**implement 任务卡必出**（§4.1 —— 拆分
   流程定义上就是 N≥2）。implement 段 —— implement → 自测 → code review → fix 循环 → ready-to-test
   —— **整段在 implementer 的 CLI session 内闭环**；交回主推 CLI 靠 §6 结构化结果 + `current.md`
   断点。CLI 切换由用户执行（自动化 harness 不属于 ccsop）。
4. **配置**：`.codex-review/config.toml` `[collaboration] design_owner / implement_owner`（操作键 +
   review 桥读它做 reviewer 派生）。**键的在场与否有语义**：**两键都缺**时桥处于 **legacy 模式** ——
   全局 `review.provider` 统管所有阶段，与此轴引入前逐字节一致。**任一键在**则派生生效（缺的那个键
   按 `claude` 解析）。非法值 loud 失败（桥降级启动），绝不静默回退。显式用户指令（"这单 codex+claude"）
   可按 session 覆盖，约定同 §1.A。
5. `review.provider = manual` 仍强制所有阶段**手动传递** —— 流程依旧有效；每阶段的 prompt/verdict 由
   用户手动转发给对侧模型。
6. **reviewer-led fallback（§1 模式 3）**用矩阵语言说 ≈ manual 传递下的 `codex+claude` 流程 —— 它早于
   此轴，作为已文档化的 legacy 别名保留。

## 2. 角色

1. **Driver** —— 澄清 + 头脑风暴（SOP §4 分块确认节奏）；设计、任务卡、验收标准；实现、测试脚本、
   验证命令；跑 `/simplify` 预筛（SOP §5.A）；跑自测并报结构化结果（§6 字段）；应用 review 修复；
   用户"test passed"后做 closeout（单主题 commit + handoff closeout + 任务卡归档 + `code-home:` 行）。
   遇阻塞（限速 / 权限 / 环境 / 契约不清）即暂停并报告 —— 不静默扩大 scope。
2. **Reviewer** —— 看真实仓库 diff / 任务卡 / 测试证据 / handoff 状态并跑 §9（9.A/9.B/9.C/9.D）；
   被要求或 §4.5 触发时做 design pre-review。不澄清需求、不实现、不写测试、不 closeout。auto 模式下
   只读运行、approval=never、无网络、无 web-search，产出严格 envelope schema + 9 个 `verdict_factors`
   + predicate（见桥设计）。
3. **User** —— 跑 verify 脚本；给"test passed"信号；显式确认所有 破坏性 / 高影响动作（合 main、push、
   删分支）；manual 模式下转发 driver↔reviewer 通信。

以上角色描述 driver-led 模式（§1 模式 1–2）在两阶段 owner 重合时（§1.D `claude+claude` /
`codex+codex`）的形态。**拆分流程**（§1.D 规则 3）下 Driver 角色沿阶段边界拆开：designer-driver 保留
需求澄清 / design / 任务卡 / 验收 / closeout，implement + 自测 + fix 职责移交 implementer（对侧 CLI），
后者经 §6 回报。在 **reviewer-led fallback**（§1 模式 3 / §8.1）中角色反转：
reviewer 拥有 设计 / 任务卡 / 验收 / closeout，driver 是纯实现者（仅 代码 + 测试脚本）。

在**自治档位**（§1.A）下：`full-auto` 中 User 的"确认破坏性/高影响动作"职责（§1.B.1–3）**不变**；full-auto
自动推进的只是*常规*的设计签字/"test passed"/本地合并闸（按 §1.B / §1.C）。

## 3. Auto-review verdict 矩阵

auto 模式下 driver 机械执行 envelope verdict —— 不重新解读散文（若散文与 verdict 冲突，**verdict 为准**）：

- `Go` / `Pass` → 进下一阶段。
- `Go-after-fixes` / `Pass-after-fixes` → 应用机械修复；**不**重跑 design/code review；继续。
- `Rereview-after-fixes` → 修复后回到对应 review 阶段（跑 `codex_fix_review`）。
- `No-Go` → 停并报告用户。

driver 自动循环到"ready-to-test"；仅断路器（最大轮次 / scope drift / 上下文耗尽 / reviewer 不可用 /
parser 不可用）或 `No-Go` 才叫回用户。桥/provider 失败时 driver **降级为手动转发**并明说；它绝不自动
恢复 —— 用户须重新启用 auto 模式。

## 4. 强制输入

行动前，driver 把这些读入上下文：
1. `docs/methodology/project-delivery-sop.md`
2. `docs/records/current.md`
3. 本模块的专题文档
4. 本轮任务卡

**session 启动 / 切换 active 任务时，优先调 `/handoff`** 而非全文读这四份（省 ~70% 启动 token）。
`/handoff` 从 `current.md` + active 任务卡里抽出最小质量门小节（目标 / 非目标 / 验收 / review 状态 /
锁定决策 / 协作边界 / 下一步）。**进 implement / fix 前你仍必须读完整任务卡**（handoff 不是 ground
truth）；implement 期间按需逐节读 SOP 全文与模块 design 文档，而非预先全读。

## 4.1 任务卡约定（design vs implement 卡）

判断本轮是否需要新 implement 任务卡，看 design 的 scope 是否拆成**多个独立 implement 阶段**
（每个有自己的 closeout + `code-home:`）：

| 情况 | 处理 |
|---|---|
| **N=1** 单轮 implement | **无 implement 卡。** 把 closeout 摘要并进 design 的 implementation-record 小节。design 文档即该轮契约。 |
| **N≥2** 多阶段（每阶段独立 closeout / 不同发版节奏） | **每阶段一张 implement 卡** `<design-id>-<phase>-implement.txt`（从 `docs/plans/_template-implement.txt`）；各归档到 `docs/plans/completed/<module>/`。 |
| **N=1 但中途暂停 / 接力** | 第一阶段收口后创建 implement 卡。 |
| **拆分流程（§1.D，`design_owner ≠ implement_owner`）** | **implement 卡必出**（定义上即 N≥2 —— 卡就是跨 CLI 接力契约）。 |

理由：单轮场景 implement 卡冗余（全并进 design 文档）；多轮场景 design 文档是跨轮持久文档，按阶段的卡
使其不膨胀，并让 `code-home:` 按阶段维护。

## 4.2 分阶段执行

- **`plan`** —— 仅 契约确认、实现方案、风险 + 验收。不改代码、不 commit。声明
  `scope / nonGoals / filesInScope / nextStep`。设计负责人先抛"业务目标 + 验收信号"（SOP §4 分块确认），豁免同上。
- **`implement`** —— 实现一个可接受子项；跑最小自测；更新 handoff + 专题文档。closeout 之外不
  `git add/commit/push`。输出 `testsRun / validationEvidence / handoffUpdated`。
- **`fix`** —— 只修 reviewer 的 findings；不扩大 scope。`summary` 聚焦"修了什么"。
- **`closeout`** —— 仅在用户回"test passed"后；由 driver 执行。步骤（按序）：
  1. 更新 `docs/records/current.md`（把任务从进行中移到 done；需要时加状态卡）；
  2. 更新专题文档（design / runbook / handoff）；
  3. 给任务卡追加 `code-home:` 行（SOP §3.4 值；未合并则 `branch=<branch>@<sha>(unmerged)`）；
  4. 把卡从 `docs/plans/active/` 移到 `docs/plans/completed/<module>/`；
  5. 单主题 conventional commit（`feat(<module>): …` / `fix(…)` / `docs(…)`），只含本轮已验收改动。

  `git push` / `git merge main` 默认**不**在此做 —— 见 §4.6。

  在 **`full-auto`（§1.A）** 下：driver 可不停地跑 closeout **+ 本地 `git merge --ff-only` 合 main**，**仅在**
  closeout commit + 自验（§1.C）之后，且 ff-only 失败即 **fail-fast**（暂停 + 报告）。**远端** push/merge 仍升级（§1.B.3 / §4.6）。

### 4.5 Design pre-review 触发清单

driver 默认**不**请求 design pre-review；命中以下任一时**必须**请求（implement 前拿回 verdict）：
1. 新增/改动外部接口（HTTP API / handler 签名 / 公共函数契约）；
2. 新增/改动数据存储 schema 或缓存 key 命名/失效规则；
3. 新增/改动权限模型（RBAC / 鉴权链）；
4. 新增/改动部署路径或定时任务（service unit / cron / 后台 worker / 队列）；
5. P0/P1 缺陷修复（影响生产可用性 / 主流程）；
6. 跨层改动（前端 + 后端契约同时改）；
7. ML / 分阶段管线边界、训练数据契约、或模型签名改动；
8. 生产可见行为改动（用户可感知逻辑）；
9. 不可逆数据操作（DDL / 批量 DML / 数据迁移）；
10. 预估 > 半天，或改动明显跨多个模块。

**不确定时，默认 pre-review。** 把 pre-review verdict 落进 design 文档或任务卡的"设计决策"小节。
`designReview` 字段（§6）为 `done` / `skipped` / `required`。

### 4.6 Feature → main 合并节奏

main 成为 canonical 后，每个 feature 在 closeout 后尽快合（不攒批）。流程有 **4 个独立用户确认点**；
driver 在每个点报告并等显式 go-ahead 再进下一个 —— 绝不捆绑步骤：
1. Driver 在 feature 分支完成 closeout commit。
2. **确认 #1（push feature）：** driver 询问；用户批准 → `git push origin <feature-branch>`。
3. **确认 #2（合 main）：** 用户批准 → `git checkout main && git merge --ff-only <feature-branch>`。
   若 ff-only 失败（main 与 feature 已分叉），暂停并报告 —— 别自行 rebase/no-ff。
4. **确认 #3（push main）：** 用户批准 → `git push origin main`。
5. **确认 #4（删远端 feature 分支）：** 用户批准 → `git push origin --delete <feature-branch>`。
6. 把任务卡 `code-home:` 从 `branch=…(unmerged)` 改为 `merged-to-main@<sha>`，作为单独 doc commit。

这些确认点不被"按 SOP 执行"自动放行；一句"go ahead"不授权一串远端 git 动作。

在 **`full-auto`（§1.A）** 下：`gated` 保留全部 4 个确认点。full-auto 只自动推进**本地**动作 —— closeout
commit + `git checkout main && git merge --ff-only <feature-branch>`（自验后；ff-only 失败即 **fail-fast**）。
**所有远端动作永远升级**（§1.B.3）：`git push origin <feature-branch>`、`git push origin main`、
`git push origin --delete <feature-branch>`、以及任何 publish/release。即便 full-auto 也绝不捆绑远端 git 动作。

### 4.7 并行 session 的 git worktree

在一台机器上并行跑多个 driver session 时，给每个一个共享同一 git 历史的隔离工作树。仅在需要时用
（并行任务 / 阻塞的 session / 不扰动主工作树未提交改动地开分支）；普通顺序工作不需要。

**推荐布局（兄弟容器）：**
```text
~/projects/
├── <repo>/                    # main worktree (default session cwd)
├── <repo>-worktrees/          # sibling container (create once, reuse)
│   ├── <short-alias-1>/
│   └── <short-alias-2>/
```
- 容器与主工作树保持**兄弟**关系，别嵌套其内（嵌套会让 test/grep/index 收集翻倍并需维护 `.gitignore`；
  用户级 `~/worktrees` 与仓库解耦、有备份缺口风险；扁平 `<repo>-<branch>/` 撑大 projects 目录）。
- 容器建一次复用；`git worktree remove` 单个工作树，保留容器。

**命令：**
```bash
mkdir -p ~/projects/<repo>-worktrees
git worktree add ~/projects/<repo>-worktrees/<short-alias> -b <full-branch-name> main
git worktree remove ~/projects/<repo>-worktrees/<short-alias>
git worktree list
```

**约束：**
1. 两个 session 不得对同一 `.git` 并发跑 git index 操作（`git add`/`commit`）。
2. review MCP server 默认只在**主工作树**跑；并行 session 要么转发给它、要么用 manual 模式。桥 build
   （`dist/`）是 per-worktree 产物，且 MCP server 无 session 中途 reload —— 并行工作树需自己 build +
   重启 session。
3. `<full-branch-name>` 对齐任务卡 `design_id` 以便审计；短路径别名仅图方便。

## 5. 任务卡格式

每轮一个纯文本文件（如 `docs/plans/active/<design-id>-<phase>-implement.txt`），最低限度：
```text
stage: implement
module: <module>
goal: <one verifiable point>
scope:
- only touch <files>
non-goals:
- ...
single-commit integrity: yes   # all changes are one atomic subject, one revertible commit
acceptance:
- <test command>
- scripts/verify_*.sh if needed
docs:
- update current.md + the design/impl doc
forbidden:
- do not commit
- do not touch unrelated files
```

## 6. 输出契约

driver 在 implement / fix / closeout 给结构化输出（即使没有自动校验 wrapper 也自查）：
1. `docsRead` —— 本轮实际用到的文档。
2. `sopChecks` —— 完成了哪些 SOP 节点（契约锁定、design 同步、build/verify、handoff 同步）。
3. `filesInScope` / `filesChanged`。
4. `testsRun` —— 跑过的验证命令。
5. `validationEvidence` —— 关键日志 / 接口结果 / 脚本 PASS/FAIL 摘录。
6. `handoffUpdated` —— 断点文档是否更新。
7. `commit` —— 是否发生 commit；非 closeout 必须 `performed=false`。
8. `mode` —— `driver-led-reviewer-gate` | `driver-led-auto-review` | `reviewer-led-closed-loop`。
8.A `flow` —— 本轮运行所在的 §1.D 流程（`claude+claude` | `claude+codex` | `codex+codex` |
   `codex+claude`）；仓库没有 `[collaboration]` owner 键（legacy）时省略。
9. `designReview` —— `required` | `skipped` | `done`。
10. `knownRisks` / `nextStep` —— 便于 reviewer 快速分诊。

## 6.A Run 报告（full-auto）

一次 **`full-auto`（§1.A）** 跑以单份 **run 报告**收尾（区别于每段的 closeout），在整跑上聚合 §6 字段：
1. 每段/slice 的**交付 scope**；
2. 每段的 **review chain** —— verdict + Critical/Important 计数 + `review_id`；
3. **升级了哪几次 + 各自怎么解的**（§1.B 的停点）；
4. 相对原方案的**偏差**；
5. **验证证据**摘要（哪些自验、哪些用户签）；
6. 每段 `code-home:`；
7. **遗留 / backlog**。

落地：终消息里一份简报 + `docs/records/current.md` 里一个持久 run-summary 指针（默认不另起 per-run 文件）。

## 8. 闭环

### 8.0 Driver-led（默认），8 步

（在 **`full-auto`（§1.A）** 下：第 2–8 步按 §1.B 谓词 + §1.C 自验边界自动推进 —— 仅在升级时叫回用户；
否则整跑在 §6.A 报告处收尾。）

1. 与用户澄清 / 头脑风暴（§4.2 节奏；可豁免）。
2. Driver 产出 design + 任务卡（`docs/plans/active/`）；判 §4.5 pre-review 需求。
3. 若复杂 / 高风险 → design pre-review；落 verdict 并调整。否则跳过。
4. Driver 实现 + 自测 + 更新 handoff/专题文档；输出 §6 字段。
5. Reviewer code review → 9.A/9.B/9.C/9.D 分级 findings。
6. Driver 修复（Critical 先于 Important），按需循环回第 5 步。
7. 用户跑 verify 脚本。
8. 用户回"test passed"后，driver closeout（§4.2 closeout）。push/merge 按 §4.6。

在**拆分流程**（§1.D 规则 3）下同样是这 8 步，多两个交接点：第 3 步后 designer-driver 写 implement
卡，用户切到 implementer 的 CLI；第 4–6 步（implement → code review → fix，reviewer =
counterpart(implement_owner)）整段在 implementer session 内跑完，然后回报 §6 结果 + 更新
`current.md`；用户切回主推 CLI 走第 7–8 步（验收 + closeout 留在 designer-driver）。

### 8.1 Reviewer-led 闭环（fallback），7 步

仅在显式选择模式 3 时用（§1）：
1. Reviewer 产出 design + 任务卡。
2. Driver 回结构化执行方案（`plan` 阶段）。
3. 方案确认后，driver 实现（`implement` 阶段）。
4. Reviewer 评审 driver 的 commit / diff / 测试结果（9.A–9.D）。
5. 有 findings 时 driver 修复（`fix` 阶段）；reviewer 只追加 findings —— 不自己写代码或测试脚本。
6. 用户在本地或目标环境测试。
7. 仅在用户回"test passed"后才 closeout（此处 reviewer 可执行）。

## 9. 评审框架

四个小节的角色：
- **9.A** spec 闸门 —— 对照任务卡："做对了没"。
- **9.B** 通用代码质量清单 —— 对照项目工程标准。
- **9.C** 模块特定清单 —— 项目在此挂自己的子节。
- **9.D** 分级 + 输出格式 —— 每个 9.A/9.B/9.C finding 按 9.D 分级编号。

顺序 + 失败处理：
1. 按 9.A → 9.B → 9.C 顺序评审。
2. 每个 finding 用 9.D 格式 `[Critical/Important/Suggestion] (9.x.y) …`。
3. 若 9.A 有 `Critical`：本轮 fix 卡只要求 9.A 的 Critical；非 Critical 的 9.B/9.C findings 仍列出
   并标 `deferred-to-next-round`（记录，不丢）。
4. 若 9.A 通过：按 9.D 规则处理 9.B/9.C。

### 9.A 规范符合
1. driver 是否按 design 实现了正确模块（非仅表面）？
2. 测试证据是否足以"ready to test"？
3. handoff 状态是否与代码状态一致？
4. closeout 是否只在用户"test passed"后发生？

### 9.B 代码质量（通用 —— 例子按 `${STACK}` 调整）
1. **日志经 helper 收口** —— SQL/缓存/profile/inflight 等无裸的临时日志。
2. **threaded 模拟/虚拟时钟处 handler 内不用 wall-clock** —— 把时间上下文穿进去。
3. **缓存层一致性** —— 新缓存 key 一起失效所有层（如 分布式缓存 + 进程内 LRU）；**绝不全局 flush**
   （`FLUSHALL` 类）。（强制 —— SOP §6.4）
4. handler 入口处的**可选依赖 nil/None 检查**，使缺失服务降级而非 panic。
5. **并发卫生** —— 新 goroutine/task 有退出路径；context 穿透；错误不吞。
6. **配置优于硬编码** —— 表/topic/队列名可经 env 覆盖，非硬编码。
7. **前端** —— 复用共享的轮询间隔/权限常量；新权限位跨层镜像。
8. **Commit** —— 单主题、conventional-commits、无混入未验收/不相关改动。（强制）

> 上面 §9.B 例子是栈相关的；保留*原则*，把具体检查适配你的栈。栈/环境特定检查（CRLF 上传、传输限速、
> 主机部署约束）作为 hook 属于 `docs/runbooks/`，不在这里。

### 9.C 模块特定清单
默认空。项目加一个 `9.C.<n> <module>` 子节，写该模块的不变式（确定性/排序、依赖最小化、跨语言 schema
契约、失败行为、时间边界 / 无前瞻、fixture 隔离、管线边界、eval/gate 覆盖）。每个声明的 eval 维度标
`COVERED / PARTIAL / MISSING`；`PARTIAL`/`MISSING` 必须登记为 deferred 并附收口计划，绝不静默放过。

### 9.D 分级（Critical / Important / Suggestion）
| 级别 | 含义 | 处理 |
|---|---|---|
| `Critical` | 阻塞 closeout：bug、数据丢失、安全/权限漏洞、硬约束违反（未授权 commit、全局 flush、任何 9.A miss） | 必须修；修完才 closeout |
| `Important` | 本轮应修：9.B/9.C 违反、明显坏味道、潜在故障 | 本轮修；若超 scope 或 9.A Critical 占满本轮可 `deferred-to-next-round` |
| `Suggestion` | 风格、可读性、小优化、预防性重写 | 记下；非阻塞；driver 可拒 + 入 backlog |

`Critical` 必须引具体触发或硬约束条款 —— 不是"感觉严重"。fix 卡按级别列 findings；**Critical 先于
Important** 修，绝不乱序。

### 9.E 收敛 + 止损（fix 循环何时停）
1. **逐轮记账（强制）：** auto 模式从 envelope 读 `verdict_factors.critical_count` /
   `important_count`；manual 模式记 `round N: Critical=a Important=b`。追踪**carried-over Critical**
   （同一 `conclusion_id`/根因在被标 resolved 后复现）。
2. **正常 vs stall：** Critical 数可能先升后降（发现新子问题 —— 大任务正常）。**stall（必须停）** 若
   任一：① 同一 Critical 连续 2 轮未解；② Critical 总数连续 2 轮不降；③ 修复在同几个点间 ping-pong 回归。
3. **stall 时：** 不自动继续。报告用户：卡住的 finding（id + 一行根因）、为何不动、≥2 选项。用户决定。
4. **轮次上限 + 升级：** auto 模式有 `max_review_rounds` 断路器；manual 模式有软上限（默认 ~5）——
   到上限仍有 Critical open 时升级给用户，别自动重启。
5. **单源优先：** 真值表 / 契约反复漂移是常见 stall 根因；逐轮修症状前先查单一真源。

### 豁免
- 9.B/9.C 仅在 implement/fix 且任务影响代码行为时强制。
- 单文件 copy/comment/纯文档改动（`docs/**`、`README.md`）豁免 9.B/9.C。
- 触及 源码/build/部署脚本的任务**不**豁免。
- 9.D 软豁免：≤ 2 个 findings 且全是 `Suggestion` → 散文即可；任一 ≥ `Important` → 完整 9.D 格式。

## 10. 推荐实践

1. 每轮给 driver 一个可接受子项，而非跨阶段巨型任务。
2. 在 `fix` 里只喂 review findings，别再喂整个需求。
3. 信 reviewer 对真实 diff 的判读，胜过 driver 的自评。
4. 若任务依赖运行中的服务，卡里写明"确认进程已重启到最新 build"。
5. 若任务依赖缓存/日志验证，卡里要求增量日志窗口 + 两次请求法。
6. 追求最高质量，默认最强模型 + max effort；仅在成本/限速下调低（见 `model-tier-strategy.md`）。
7. 若 driver 卡在实现，reviewer 可分析/分诊但不得接管实现。

### 10.A 上下文工程 / subagent 卸载（driver 侧）
单线程深度工作是默认；卸载**基于判据，非默认**。

**卸载给 sub-agent**（fresh context，返回结论而非文件转储）当：
1. 跨多目录/约定的宽扇出搜索，你只要结论；
2. 与主线弱耦合、可并行的独立探针；
3. 一次性大 token 任务、其输出可压成几行（全仓 grep 摘要、外部文档略读）。

**不要卸载**当：需要累积跨步上下文的深度工作；改主代码或你将持续操作的工作；依赖大量中间状态的结论。

**上下文预算意识：** 长 session 上盯住 context 水位；近阈值时落一个 `/handoff` 断点（必要时 compact），
而非硬推进 context rot。
