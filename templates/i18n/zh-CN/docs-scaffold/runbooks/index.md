# Runbooks 索引

环境、部署、运行、验证步骤存放于此。**栈/环境特定 hook**（见 SOP §2.3）属于这里，而非方法论
文档 —— 例如行尾（CRLF）上传检查、传输限速（`${RSYNC_BWLIMIT}`）、主机特定部署约束、服务重启流程。

`deploy-runner` agent 按 runbook 逐步执行、遇任何异常即停；在此声明每次部署的目标、预期结果、
以及任何栈 hook，供 agent 取用。

| runbook | 用途 |
|---|---|
| <path> | <one line> |
