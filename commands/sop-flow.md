---
description: Show or set the standing ccsop collaboration flow for Claude-driven work.
---

# /sop-flow — inspect or switch the Claude-driven collaboration flow

Work in `${CLAUDE_PROJECT_DIR}`. This command is a thin UX wrapper over the
`ccsop_configure` machine contract. It never edits `.codex-review/config.toml` itself and has no
shell/manual-edit fallback.

## Step 0 — guards

If `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, abort and ask the user to restart the session or
reload plugins. If `.codex-review/config.toml` is missing, ask them to run `/sop-init`.

Discover `ccsop_configure`. If it is missing, from an older bundle, or not registered in this
session, make zero writes and say:

```text
ccsop_configure is unavailable. Run /mcp and reconnect/restart the ccsop review bridge, then retry.
No config was changed.
```

Do not suggest direct TOML edits or a shell fallback.

## Step 1 — handshake and status

Call `ccsop_configure` with `action=status`. Require `contract_version=2`; accept
`observed_schema=1|2` for Phase 1 flow actions.

- `observed_schema=null`: make zero writes and ask the user to run `/sop-update`, which performs
  the server-fixed `stamp-schema-v1` migration.
- any schema other than `1|2`, or any contract other than `2`: fail loud, show the observed and
  supported values, make zero writes, and ask for a compatible ccsop update.

Use the returned owners, implement gate, tiers, and config sha as the only state snapshot. The
flow contract and reviewer derivation live in the shipped control-surface contract, not in this
prose wrapper. Status is read-only.

If status returns `config_valid=false`, show its `validation_error` and raw owner values. An
explicit legal set may repair invalid `collaboration.design_owner` / `implement_owner` values:
the server publishes only when the resulting **whole config** passes TOML+Zod validation. If an
unrelated invalid field remains (or TOML cannot be inspected), the server rejects with zero
writes. Report the exact field and recover via `/sop-update` where supported or a verified
`.ccsop/backups/config/<sha256>.toml` preimage; this command still never edits TOML itself.

## Step 2 — dispatch on `$ARGUMENTS`

Trim whitespace.

- Empty: print current status, then offer exactly `claude+claude`, `claude+codex`, and
  `keep current`. Mark the active flow. If no interactive picker exists, print the typed usage and
  stop without writing.
- `claude+claude` or `claude+codex`: continue.
- `codex+codex` or `codex+claude`: reject without writing. Codex-driven flows are selected from
  Codex with `$sop-flow`; schema 1 is manual relay, while schema 2 may expose the independently
  operator-enabled `claude_implement` proposal adapter.
- anything else: print `Usage: /sop-flow [claude+claude|claude+codex]` and stop.

Status output:

```text
Flow: <resolved flow or legacy>
Design review: <derived reviewer>
Code review: <derived reviewer>
Fix review: reviewer recorded for that review session
codex_implement enabled: <true|false>
claude_implement enabled/readiness: <enabled + validation/apply status>
Per-session override: "这单走 <flow>" / "this one <flow>"
Set standing default: /sop-flow claude+claude | /sop-flow claude+codex
```

If `review.provider=manual` is reported by the bridge, describe delivery as manual without
pretending an automatic reviewer will run.

## Step 3 — one CAS mutation

Call `ccsop_configure` once with:

```json
{
  "action": "set-flow",
  "flow": "<selected flow>",
  "expected_config_sha256": "<sha from Step 1>"
}
```

The server owns the exact coupled mutation:

- `claude+codex` enables the existing Codex implement dispatcher;
- `claude+claude` disables that dispatcher;
- any implement-owner change on schema 2 also forces `[implement.claude].enabled=false` and
  returns `safety_disable=true`; this command never re-enables it;
- the provider key and all unrelated bytes remain untouched.

On sha mismatch, report the concurrent change, call read-only `status` again, and ask the user to
retry the selection. Do not silently replay a mutation against a new sha.

## Step 4 — report

Print the server-returned `changed_keys`, before/after sha, and backup path. If `changed_keys` is
empty, say `already active; nothing changed`.

The next public bridge invocation re-reads config, so do **not** ask for reload after an ordinary
flow mutation. `/mcp` reconnect/restart is needed only when the bundle/tool registration itself
was unavailable or changed.
