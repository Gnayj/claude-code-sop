# ccsop flow contract v2

- Claude 命令入口只接受 `claude+claude` / `claude+codex`。
- Codex skill 入口只接受 `codex+codex` / `codex+claude`。
- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。
- tool 缺失、旧 bridge 或未重启：零写并提示 `/mcp` 重连/重启。
- invalid config 的 status 返回 error/raw owners；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。
- schema=1 保持 Phase 1：`codex+claude` delivery 为 `manual relay`，flow/Codex tier 仍可用。
- schema=2 且 bridge catalog 含 `claude_implement` 时，`codex+claude` 可使用 proposal adapter；flow 永不自动 enable。
- implement owner 变化会原子强制 `[implement.claude].enabled=false`；重新 enable 只能由 operator 在 agent session 外完成。
- 禁止 shell 或手改 TOML fallback；schema 迁移/回滚只调用 server-fixed action。
