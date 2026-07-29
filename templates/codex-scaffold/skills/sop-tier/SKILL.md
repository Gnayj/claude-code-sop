---
name: sop-tier
description: Show or explicitly set consumed ccsop review and Codex dispatch/default model-effort tiers from a Codex session.
---

# SOP Tier

Read `references/contract.md`.

- Empty arguments or implicit activation are read-only: call `ccsop_configure action=status`.
- Legal schema-1 scopes are `claude-review`, `codex-review`, `codex-dispatch`, and
  `codex-default`. Schema 2 additionally exposes `claude-implement`.
- An explicit mutation first reads status and requires `contract_version=2` /
  `observed_schema=1|2`, then calls `ccsop_configure action=set-tier` with the status sha and only
  the selected scope's documented fields.
- If status reports `config_valid=false`, display its validation error and raw tiers. A legal set
  may repair the selected target keys only when the resulting whole config validates; unrelated
  errors fail with zero writes. Point to `/sop-update` or a verified
  `.ccsop/backups/config/<sha256>.toml` preimage, never a manual-edit fallback.
- Codex effort: `""|minimal|low|medium|high|xhigh`. Claude review effort:
  `""|low|medium|high|xhigh|max`; Claude review backend is `api|cli`.
- `claude-implement` requires schema 2 plus a live `claude_implement` tool. It accepts
  model/effort and shrink-only timeout/output/per-design/daily budget caps. Never send
  backend, cli_path, version override, validation paths/commands/globs, advisory apply, or
  enabled: those are operator-only. A requested limit above
  `min(on-disk current, compiled maximum)` is a zero-write error.
- `codex-dispatch` controls `codex_implement`, not the current host session. Use built-in `/model`
  for the current Codex session.
- Reject every other scope. On schema 1, fail `claude-implement` with `/sop-update` remediation
  while preserving the Phase 1 scopes. On a missing/old/unrestarted tool, make zero writes, give `/mcp`
  reconnect guidance, and never fall back to manual TOML/shell editing.
