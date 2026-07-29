# ccsop flow contract v1

- Claude 命令入口只接受 `claude+claude` / `claude+codex`。
- Codex skill 入口只接受 `codex+codex` / `codex+claude`。
- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。
- tool 缺失、旧 bridge 或未重启：零写并提示 `/mcp` 重连/重启。
- invalid config 的 status 返回 error/raw owners；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。
- `codex+claude` 在 Phase 1 的 delivery 是 `manual relay`。
- 配置 schema 必须为 `1`；禁止 shell 或手改 TOML fallback。
