---
name: simplify
description: 按 ccsop 机器阈值判定当前改动，并检查复用、质量、效率与覆盖；显式调用时修复问题并重跑聚焦测试。
---

# Simplify

读取 `references/contract.json`；它是机器真源。不要从方法论散文解析阈值。

1. 确认当前是 git feature branch 且存在配置的 base ref；否则报告 `EXEMPT` 与准确原因。
2. 对允许的代码后缀，汇总 committed、staged、unstaged、untracked 四段 add+delete 行数，
   路径不得重复计数；报告分段证据。
3. 未达阈值或没有合格后缀：报告 `EXEMPT`；否则报告 `TRIGGER`。
4. 从 reuse、quality、efficiency、coverage 四角检查改动。
5. 只有显式 `$simplify` 或用户明确要求 simplify 并修复时才编辑 scope 内文件、修复真实
   finding、重跑聚焦测试并报告证据。隐式触发只诊断，编辑前先取得确认。

这是 cheap pre-screen，不替代强制的跨模型 code review。
