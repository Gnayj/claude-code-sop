# 项目交付 SOP（可复用模板）

> ccsop canonical（英文原版的中文维护版）。`/sop-init` 把它物化进你的仓库；`/sop-lang` 用另一种
> 语言重新物化。机器稳定面（verdict 枚举、`§` 锚点、`code-home:` 字段名及其值、config key、命令名）
> 翻译时逐字保留。

## 1. 目标与范围

1. 目标：让 需求 → 实现 → 测试/验收 → 文档 成为单一闭环，使上下文永不丢失、永不重新推导。
2. 范围：本项目及后续同形态项目（把 `${STACK}` 换成你的 —— 例如 后端 + 前端 + 数据库 + 缓存 + 运维/部署）。

## 2. 原则

1. 契约先行、代码其次：实现前先确认行为契约与验收标准。
2. 小步推进：一次只推进一个可独立验证的子项。
3. 未验收不算完成："已实现" ≠ "已完成"；改动只有过了测试闸门才算完成。
4. 文档即断点：每个关键改动都落进文档，使工作可冷启动恢复。
5. 就事论事：结论与权衡只按 正确性、性能、稳定性、可维护性、风险、成本/收益 评判 —— 绝不为迎合用户偏好。
6. 如实相告：允许（且应当）得出"此方案非最优"或"这应重做"的结论，但永远附具体理由与替代方案。

## 3. 标准文档结构（每项目）

1. `docs/records/current.md` —— 当前状态、已做、未做、关键接口、下一步。
2. `docs/records/archive/<period>.md` —— 按季度/阶段归档的历史增量。
3. `docs/methodology/` —— 交付 SOP、协作协议、工作流总览、模型分级策略。
4. `docs/plans/active/` 与 `docs/plans/completed/` —— 进行中与已完成任务卡。
   - 归档时追加一行 `code-home:` 记录当前事实状态。合法值：
     - `code-home: merged-to-main@<sha>` —— 已合 main。
     - `code-home: branch=<branch>@<sha>(unmerged)` —— 在 feature/主干分支，尚未合 main。
     - `code-home: deployed@<sha>` —— 已部署生产，不一定在 main。
     - `code-home: doc-only` —— 任务卡只动文档；无代码归宿。
     - `code-home: superseded-by@<sha>` —— 被后续 commit 覆盖/替代。
     - `code-home: reverted@<sha>` —— 已显式 revert。
   - 此字段记录*当前事实*；不强制 closeout 时合并。要点是几个月后你能回答"这个任务的代码现在在哪"，
     而任务卡归档状态与真实部署状态之间不漂移。
5. `docs/design/` —— 模块级功能设计与架构。
6. `docs/runbooks/` —— 环境、部署、运行、验证步骤（栈特定 hook 在此）。
7. `docs/references/` —— schema、生成产物、静态参考材料。

## 4. 需求 → 发版流程

1. 需求澄清
   - 产出：scope、非目标、数据契约、性能目标、验收标准。
   - 契约不清不进编码。
   - **分块确认（默认开，可豁免）**：本轮设计负责人（`Driver-led + reviewer gate` 下是 driver，
     回退到 `dual closed-loop` 后是 reviewer）先只抛"业务目标 + 验收信号"给用户确认，再填
     scope/非目标/契约/风险。目的：给用户 ≥2 个独立验证点，而非一大块 + 一句"OK"。豁免（可直接给草案）：
     1. 用户已给足目标 + 验收契约，无需回问即可写 scope；
     2. 只读任务：review、状态查询、日志/接口诊断、文档调研、历史追溯 —— 无代码改动；
     3. bug 的"是否缺陷"分诊阶段 —— 分块确认在确认为真缺陷、需要修复方案之后才做；
     4. 明显 < ~30 分钟、无数据契约、无新接口、无性能目标的小修（含纯文案/注释/typo）。
2. 设计
   - 产出：API/SQL/缓存/schema/权限/风险/回滚方案。
   - 编码前需用户确认"方案可执行"。
3. 增量实现
   - 一次实现一个子项；避免难以回归的大改。
   - 实现后必须能编译运行。
4. 自测 + 证据
   - 最低：build 通过 + 关键路径验证 + 日志证据（**必须**用**增量日志窗口** —— 绝不 `tail` 整个
     日志来判断；见 §6.4）。
5. 用户测试
   - 提供"可复制粘贴运行"的测试命令 + 通过标准。
   - 开发者先在本地跑同一验证脚本，再交给用户。
   - 若改动触及服务端 binary / 前端 build / 依赖脚本的运行时，且验证复用了*已在运行的进程 / 已部署
     服务*，先确认该进程已重启 / 重新部署到本轮 build —— 否则旧进程的结果无效（见 §6.4.6）。
   - 交付前更新断点文档（`docs/records/current.md` + 相关专题文档）。
6. 完成判定
   - 子项只有在用户明确回"test passed"后才算 `done`。
   - **文档 / 方法论 / 只读改动**（无可运行"测试"）：完成信号 = code/design review Pass（或显式豁免）
     + 用户确认 closeout；不必等"test passed"字样。见 §6.2。
7. 文档 closeout
   - 更新 `current.md`（已做 / 未做 / 下一步）。大改动同时更新功能/归档文档。
8. 提交 closeout
   - 完成判定后，把"本轮已验收改动"单独提交。
   - 先完成文档 + 断点更新，再 `git commit`。
   - 未验收/不相关/临时调试内容不得混入该 commit，除非用户明确要求。
9. 并行 session 隔离
   - 多个 session 推进不同任务时，按 `claude-code-sop-collaboration.md §4.7` 建 git worktree
     （兄弟容器路径模式）。

## 4.1 委托协作规则（减少重复确认）

1. 当用户说"方案确认后按 SOP 执行"，默认含义是：
   - agent 可直接做 非破坏性实现、build、test、格式化、日志分析、定向清缓存、`git add`、`git commit`；
   - 用户一回"test passed"，agent 即按"提交 closeout"提交已验收改动。
2. 若平台仍需授权，agent 应申请**最小可复用前缀**（持久），而非每命令重问，也不对同类非破坏性命令
   重复要口头同意。
3. "按 SOP 执行"不绕过平台权限系统 —— 它意味着 agent 默认行动，对需授权的命令用最小/持久授权。
4. 以下**永远**需单独显式确认（绝不被"按 SOP"自动放行）：
   - 删除、覆盖、回滚、或重置不可恢复内容；
   - 破坏性操作（`rm`、`git reset --hard`、`git checkout --` …）；
   - 改生产配置或服务；
   - 覆盖数据库数据、不可逆 DDL/DML；
   - 对生产环境 部署 / 重启 / 清空 / 批量写。

## 5. 功能清单（执行时勾）

1. 需求契约已锁定（含边界条件）。
2. design 文档已更新。
3. 实现完成。
4. **`/simplify` 提测前预筛已跑或豁免**（见 §5.A）。若触发，跑 `/simplify` 并自修全部问题再进下一步；
   若豁免，在自测证据里记理由。
5. Build 通过（如 `${BUILD_CMD}`）。
6. 关键路径测试脚本可跑。
7. 日志可观测（命中/回源/延迟/错误原因）。
8. 缓存场景提供**定向清缓存**命令（禁 `FLUSHALL`）。
9. 提供用户测试命令（优先脚本）。
10. 用户确认完成（常规 = "test passed"；文档/方法论/只读 按 §6.2 = review Pass + 用户 closeout）。
11. 断点文档已更新。
12. 已验收改动单独提交，或显式记录为何尚未提交。
13. 若用户声明"按 SOP"，授权前缀策略遵循最小可复用原则。

### 5.A `/simplify` 提测前预筛（默认强制）

`/simplify` 是 Claude Code 内置 skill（"Review changed code for reuse, quality, and efficiency,
then fix any issues found"），用作 reviewer 闸门（`codex_code_review`）*之前*的廉价本地预筛，
过滤死代码 / 重复 / 过度抽象，减少 reviewer 轮次。

**触发（机器判据）：**
- 改动文件后缀 ∈ 代码 allowlist（如 `.go .ts .tsx .js .py .vue .sh` —— 按 `${STACK}` 调整）；
- feature 分支相对 base 的 add+del ≥ 30 行（committed + staged + unstaged + untracked）；
- base ref 默认 `main`；非 git 仓 / 无 `main` / detached HEAD → 跳过 → 豁免（记理由）；
- 否则（纯文档 / SOP / typo / 小修 / 后缀不在 allowlist）→ 豁免。

**流程（触发时）：** 调 `/simplify` → 若"无问题"进 build → 若有问题，就地修复并重跑至无问题
（或剩余项以 inline note 确认为非问题）→ 再自测 → reviewer 闸门。

**不可用 fallback：** 若 skill 因任何原因无法调用，跳过预筛，在自测证据里记
`"/simplify skipped: <reason>"`，**不阻塞**，进 reviewer 闸门。

**与 reviewer 闸门的关系：** `/simplify` 不替代 reviewer。它抓廉价的本地复用/质量/效率问题；reviewer
仍覆盖 架构 / scope drift / 跨切面一致性。正交且串行（implement → /simplify → 自修 → 自测 → review）。

## 6. 测试 SOP（统一判定）

### 6.1 测试层

1. Build：能否编译/打包？
2. 接口：主响应、错误分支、权限分支。
3. 性能：关键路径延迟、缓存命中率、回源行为。
4. 回归：旧功能是否被破坏？

### 6.2 通过标准（全部必需）

1. 行为符合方案。
2. 无新增阻塞错误（P0/P1）。
3. 关键日志与指标符合预期。
4. 用户明确回"test passed"。

**文档 / 方法论 / 只读改动**（无可运行测试）：1–4 不适用；完成信号是
**review Pass（`codex_code_review` / `codex_design_review` Pass / All-fixed，或显式豁免）+ 用户 closeout**。
纯文档改动仍用单主题 commit + 文档 closeout，但不要求"test passed"字样。

在 **`full-auto`**（`claude-code-sop-collaboration.md §1.A`）下：driver 的自验**仅**对机器可验的验收（build /
测试 / grep-schema-drift 不变式 / spec 符合性）顶替用户"test passed"。**主观质量、真实环境/生产验收、以及
§4.1 永远确认动作仍需用户**（collaboration §1.B / §1.C）。

### 6.3 失败时

1. 保留失败日志 + 复现命令。
2. 状态标 `testing_failed`。
3. 修复后重跑同一验证。

### 6.4 缓存与日志验证标准（默认强制）

1. **增量日志窗口**
   - 每次验证前记录起始行：`N=$(wc -l < ${LOG_PATH})`。
   - 验证后只看增量：`tail -n "+$((N+1))" ${LOG_PATH}`。
2. **缓存命中验证（两次请求法）** *（栈有缓存层时适用）*
   - 第一次请求可回源；第二次同参请求必须命中缓存。
   - 验收须同时显示：回源次数 + 缓存命中次数。
3. **回源路径验证（排除缓存干扰）**
   - 验证 fallback 前只清*目标*缓存 key/pattern（绝不全局 flush）。
4. **脚本化验证（优先）**
   - 每个高频/复杂路径都应有 `scripts/verify_*.sh`，打印 `PASS/FAIL` 并含关键日志摘录。开发者先本地跑，用户再重测。
5. **日志判断约束**
   - 绝不从陈旧历史日志判"通过" —— 用本轮增量日志 + 当前响应。
6. **进程-版本一致性（默认强制）**
   - 若验证依赖运行中的服务进程，不要在代码已改但进程未重启/重部署时开测；先确认接口跑的是本轮 build。

> 栈特定验证 hook（如 CRLF 上传检查、传输限速、主机特定部署约束）作为可配置 hook 存于
> `docs/runbooks/` —— 见设计 §2.3 与 runbooks 索引。上面的*强制*桶保持无条件；只有栈/环境项可配置。

## 7. Backlog 管理 SOP

### 7.1 状态
`todo`（未开始）· `in_progress`（开发中）· `testing`（待用户测）· `done`（用户确认）·
`blocked`（依赖/环境）· `cancelled`。

### 7.2 优先级
`P0`（阻塞主流程 / 生产宕机）· `P1`（核心功能缺失或明显性能问题）· `P2`（体验 / 可维护性）·
`P3`（长期改进）。

### 7.3 记录模板
```text
[ID] [P1] [in_progress] <module>: <one-line item>
- Context: ...
- Contract: ...
- Acceptance: <log keyword + interface behavior + perf target>
- Evidence: <log keyword + interface result>
```

## 8. 文档更新规则（强制）

1. 每完成一个子项就更新 `current.md`。
2. 每个大功能至少一份专题文档（design 或 validation）。
3. 长/堆叠的历史日志移到 `archive`；当前文档保持可读。
4. 文档里的"未做"项必须与真实代码状态一致。

## 9. 提交与发版规则

1. 一 commit 一主题 —— 不混改（单主题 commit，强制）。
2. commit 前至少：build 通过、关键测试通过、文档同步。
3. 发版前再加：配置检查（环境、权限、连接信息）+ 回滚路径。
4. 新外部依赖合法性（GSD slopcheck 思路）：安装 AI 推荐或新引入的第三方依赖前，核验它 —— 官方源 /
   拼写正确（防 typo-squat）/ 活跃维护 / 该版本确实存在；非标准依赖与用户确认，绝不静默安装。

## 10. 断点恢复（上下文丢失时）

1. 先读 `docs/records/current.md`（或跑 `/handoff`）。
2. 再读相关专题文档（design/validation）。
3. 追历史，读对应 `docs/records/archive/<period>.md`。
4. 恢复后，改动任何东西前先陈述"当前状态 + 下一步"。

## 11. 可复用 resume prompt

```text
Continue per the SOP:
1) Module: {...}
2) This sub-item: {one verifiable point}
3) Acceptance: {log keyword + interface behavior + perf target}
4) Rule: mark done only after I reply "test passed"
5) Execute: after plan confirmation, advance per the SOP for non-destructive/low-risk actions,
   requesting minimal persistent authorization
6) Require: keep current.md + the topic doc in sync
```

## 12. Bug SOP（缺陷）

### 12.1 流程
1. 分诊 —— 按 §7.2 优先级 `P0`–`P3`；`P0`（生产阻塞）先止血，`P1` 优先修。
2. 复现 —— 步骤、预期、实际、影响面；冻结证据（日志/SQL/响应/截图，≥1）。
3. 止血（P0/P1）—— 开关/降级/回滚/限流，以最小风险恢复可用。
4. 根因 —— "直接原因 + 触发条件 + 为何此前未暴露"。
5. 修复 —— 最小闭合改动；缺陷修复内避免大重构。
6. 验证 + 回归 —— 缺陷路径重新通过；相关路径回归干净。
7. 完成 —— 用户回"test passed"后才 `done`。
8. 文档 closeout —— 更新 `current.md`：症状、根因、修复、验证命令、状态。
9. 冻结验证 —— 把该缺陷的验证脚本/命令并进 SOP 或功能验证文档，作为同类问题的默认项。

### 12.2 缺陷状态
`todo` · `in_progress` · `mitigated`（仅 P0/P1）· `testing` · `done` · `reopened`。

### 12.3 缺陷卡模板
```text
[BUG-ID] [P1] [in_progress] {module}
- Symptom / Repro / Expected / Actual / Blast radius / Evidence
- Root cause / Mitigation / Fix / Verify command / Pass criteria / State
```

## 13. Spike SOP（可行性实验）

当方案/契约/性能未知、须先实验再选方向时，跑 spike 而非当作 implement 推进。目标：把"试错"与
"交付"分开，使探针代码不渗入主/生产路径。

### 13.1 何时是 spike
1. 可行性 / 性能上限 / 数据契约未知 —— 先证"能不能 / 值不值"。
2. A/B 对比、二分、profiling —— 仅为结论的临时实验。
3. 方案已定、只是写实现 → **不是** spike；走常规流程。

### 13.2 探针代码放置（强制）
1. 优先**一次性独立脚本**（`scripts/spike_*`、`scripts/probe_*`）；不混入主/生产代码。
2. 若必须动主代码：用显式开关隔离（默认关）并在 handoff 或任务卡里登记"临时探针改动 + 清理义务"。
3. 单向依赖：主代码不得 import 探针脚本。

### 13.3 verdict（三态）
每个 spike 以一行收尾：`VALIDATED / INVALIDATED / PARTIAL` + 一行证据 + 数据/日志锚点
（行号、commit、表、延迟数字）。绝不"试了，感觉还行"。

### 13.4 清理 / 固化（强制，二选一）
1. **删除** —— 移除一次性代码；若动过主代码，closeout 前清理（见 §14）。
2. **固化** —— 把持久价值提升为 `scripts/verify_*.sh` 或 baseline/降级开关（保留旧路径作 fallback +
   A/B，不覆盖）。
verdict 本身（verdict + 证据 + 权衡）落进 design 的 implementation-record 小节或 records。

## 14. Closeout 完整性自审（GSD forensics）

§5 在*测试前*查"本轮活干了没"；§14 是*closeout 时*的取证复查 —— "状态有没有漂移 / 遗留有没有混入"。
closeout 前手动跑：

1. `current.md` "未做 / 下一步"与真实代码状态一致 —— 无错设状态，无陈旧 done 项。
2. `git status` 干净 —— 无遗留未提交改动、无废弃 diff、无临时调试输出（`console.log` / `print` / 临时日志）。
3. 探针 / 诊断补丁已清理（按 §13.2 登记）；主代码无裸临时开关。
4. 无 abort/中断留下的半成品 commit 或孤儿分支。
5. 已归档任务卡的 `code-home:` 行真实可查（对照实际 commit/branch/deploy）。
6. 新依赖（如有）已按 §9.4 核验。
