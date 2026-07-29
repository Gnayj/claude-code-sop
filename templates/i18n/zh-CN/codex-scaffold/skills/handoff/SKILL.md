---
name: handoff
description: 在 session 启动、切任务、恢复工作或用户询问现状时，生成一份最新的 ccsop 结构化交接。
---

# Handoff

每次都重读真源，绝不缓存 handoff。

1. 读 `docs/records/current.md`，按标题识别当前状态和 active task，不假设固定章节号；
   跳过 archive/closeout 索引。
2. 提取 active 的 `task card:` / `任务卡:` 与 `design doc:` / `design 文档:` 路径。
3. 每个 active artifact 只读 goal/scope、non-goals、acceptance、review state、locked
   decisions、collaboration boundary、next step 与 `code-home:`。
4. 在约 150 行内输出协作模式、active tasks、上述字段、路径异常 warning 与 next step。
5. 明示：进 implement/fix 前仍必须完整读取 active task card。

除非用户要求，不读 archive、已关卡或无关专题文档；不得推断缺失内容。
