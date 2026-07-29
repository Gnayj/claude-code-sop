---
name: sop-flow
description: 查看或显式设置 Codex 主推工作的 ccsop standing flow：codex+codex 或 codex+claude。
---

# SOP Flow

读取 `references/contract.md`。

- 空参或隐式触发只读：调用 `ccsop_configure action=status`，展示当前 owners/reviewers 与
  两个合法 Codex flow。
- 只有显式 `$sop-flow codex+codex` / `$sop-flow codex+claude` 才可写。
- 写前先 status，要求 `contract_version=1` 且 `observed_schema=1`；再以 status sha 调
  `action=set-flow`。
- 若 status 报 `config_valid=false`，展示 validation error 与 raw owners。合法显式 set 只有在
  resulting whole config 校验通过时才可修 owner keys；无关错误必须零写失败。指向
  `/sop-update` 或已验证的 `.ccsop/backups/config/<sha256>.toml` preimage，绝不 fallback 手改。
- 拒绝 `claude+*` 并指向 Claude `/sop-flow`。
- `codex+claude` 明报 `delivery=manual relay`；Phase 1 没有自动 Claude writer。
- tool 缺失/过旧/bridge 未重启时零写并提示 `/mcp` 重连/重启；禁止 TOML/shell fallback。
