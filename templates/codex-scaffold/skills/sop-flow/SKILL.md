---
name: sop-flow
description: Show or explicitly set the standing ccsop flow for Codex-driven work: codex+codex or codex+claude.
---

# SOP Flow

Read `references/contract.md`.

- Empty arguments or implicit activation are read-only: call `ccsop_configure` with
  `action=status`, then show the current owners/reviewers and the two legal Codex-driven choices.
- Only explicit `$sop-flow codex+codex` or `$sop-flow codex+claude` may mutate.
- Before mutation, call status and require `contract_version=1` and
  `observed_schema=1`. Then call `ccsop_configure` with `action=set-flow`,
  `expected_config_sha256=<status after_sha256>`, and the requested flow.
- If status reports `config_valid=false`, display its validation error and raw owners. A legal
  explicit set may repair the owner keys only when the resulting whole config validates; an
  unrelated error is a zero-write failure. Point to `/sop-update` or a verified
  `.ccsop/backups/config/<sha256>.toml` preimage, never a manual-edit fallback.
- Reject `claude+*` and point to Claude `/sop-flow`.
- For `codex+claude`, report `delivery=manual relay`; Phase 1 has no automated Claude writer.
- If the tool is missing, old, or the bridge was not restarted, make zero writes and tell the user
  to reconnect/restart `/mcp`. Never edit TOML or use a shell fallback.
