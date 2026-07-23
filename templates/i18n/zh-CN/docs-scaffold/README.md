# docs/ — 分层地图

本仓库遵循 **ccsop** 交付工作流。文档分层组织：

| 目录 | 存放 |
|---|---|
| `records/` | `current.md`（实时断点）+ `archive/<period>.md`（历史增量） |
| `methodology/` | 交付 SOP、协作协议、工作流总览、模型分级策略（ccsop canonical；经 `/sop-update` 更新） |
| `plans/` | `active/` + `completed/` 任务卡，以及 `_template-{design,implement}.txt` 模板 |
| `design/` | 模块级功能设计与架构 |
| `runbooks/` | 环境、部署、运行、验证步骤（栈/环境特定 hook） |
| `references/` | schema、生成产物、静态参考材料 |

**从这里开始**：跑 `/handoff`（或读 `records/current.md`）了解当前状态。规则在
`methodology/project-delivery-sop.md`（单一真源）；`project-sop` skill 是执行地图。

受管文件来源记录在 `.ccsop/manifest.json`（逐文件 owner + source/render 双 sha，翻译文档另有
maintained 译文源 sha）。`owner=ccsop` 的文件由 `/sop-update` 维护；`records/current.md` 是
`owner=overlay`（归你）。想在托管 Markdown 文档**内部**加自己的内容而不 fork 它，用消费者扩展块
包起来（`<!-- consumer:begin <slug> anchor="<章节号>" -->` … `<!-- consumer:end <slug> -->`）——
更新会原位保留它。
