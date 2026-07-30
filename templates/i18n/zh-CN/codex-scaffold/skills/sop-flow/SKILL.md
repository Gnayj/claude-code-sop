---
name: sop-flow
description: 查看或显式设置 Codex 主推工作的 ccsop standing flow：codex+codex 或 codex+claude。
---

# SOP Flow

读取 `references/contract.md`。

- 空参或隐式触发只读：调用 `ccsop_configure`，参数为 `action=status`，展示当前 owners/reviewers 与
  两个合法 Codex flow。
- 只有显式 `$sop-flow codex+codex` / `$sop-flow codex+claude` 才可写。
- 写前先 status，要求 `contract_version=2` 且 `observed_schema=1|2`；再以 status sha 调
  `action=set-flow`。
- 若 status 报 `config_valid=false`，展示 validation error 与 raw owners。合法显式 set 只有在
  resulting whole config 校验通过时才可修 owner keys；无关错误必须零写失败。指向
  `/sop-update` 或已验证的 `.ccsop/backups/config/<sha256>.toml` preimage，绝不 fallback 手改。
- 拒绝 `claude+*` 并指向 Claude `/sop-flow`。
- schema=1 时，`codex+claude` 明报 `delivery=manual relay` 并提示 `/sop-update`。
- schema=2 时还要求 live tool catalog 真有 `claude_implement`；按 status 展示 readiness、
  validation 与 apply policy。flow 绝不自动 enable。operator 只能在 agent session 外把生成的
  `enabled=false` 改为 true；本 skill 不执行也不建议 agent-side enable。
- implement owner 变化时展示 server 的 `safety_disable=true` 与被强制写回的
  `[implement.claude].enabled=false`。
- tool 缺失/过旧/bridge 未重启时零写并提示 `/mcp` 重连/重启；禁止 TOML/shell fallback。
