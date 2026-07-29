---
name: sop-tier
description: 从 Codex session 查看或显式设置已被消费的 review、Codex dispatch/default 模型与 effort 档。
---

# SOP Tier

读取 `references/contract.md`。

- 空参或隐式触发只读：调用 `ccsop_configure action=status`。
- 合法 scope：`claude-review`、`codex-review`、`codex-dispatch`、`codex-default`。
- 显式写入先 status，要求 `contract_version=1` / `observed_schema=1`，再携 status sha 调
  `action=set-tier`，只传目标 scope 的字段。
- 若 status 报 `config_valid=false`，展示 validation error 与 raw tiers。合法 set 只有在
  resulting whole config 校验通过时才可修所选 target keys；无关错误必须零写失败。指向
  `/sop-update` 或已验证的 `.ccsop/backups/config/<sha256>.toml` preimage，绝不 fallback 手改。
- Codex effort：`""|minimal|low|medium|high|xhigh`；Claude review effort：
  `""|low|medium|high|xhigh|max`；Claude review backend=`api|cli`。
- `codex-dispatch` 控制 `codex_implement`，不是当前 host session；当前 Codex 用内置 `/model`。
- 拒绝其他 scope。tool 缺失/过旧/未重启时零写并提示 `/mcp`，禁止手改 TOML/shell fallback。
