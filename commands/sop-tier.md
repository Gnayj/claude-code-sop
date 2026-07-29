---
description: Show or set the real Claude-review and Codex bridge model/effort tiers.
---

# /sop-tier — inspect or set consumed model tiers

Work in `${CLAUDE_PROJECT_DIR}`. This command is a thin UX wrapper over `ccsop_configure`. It
never edits TOML directly and never offers a shell/manual-edit fallback.

## Step 0 — guards

Apply the orphaned-root and missing-config guards from `/sop-flow`. Discover
`ccsop_configure`; if the tool is missing/old/unregistered, make zero writes and direct the user
to `/mcp` plus reconnect/restart.

Call `action=status`. Require `contract_version=1` and `observed_schema=1`. Schema absent means
`/sop-update` must run the fixed stamp action; an unknown schema/contract fails loud with zero
writes.

If status returns `config_valid=false`, show its `validation_error` and raw tier values. An
explicit legal set may repair the selected invalid tier key: the server publishes only when the
resulting **whole config** passes TOML+Zod validation. Unrelated invalid fields (or uninspectable
TOML) reject with zero writes; report the exact field and recover via `/sop-update` where
supported or a verified `.ccsop/backups/config/<sha256>.toml` preimage. Never hand-edit on behalf
of this command.

## Step 1 — scopes and status

Only expose scopes with a real Phase 1 consumer:

| Public command scope | Machine scope | Consumer |
|---|---|---|
| `claude` | `claude-review` | `[review.claude]` |
| `review` | `codex-review` | `[review.codex]` |
| `implement` | `codex-dispatch` | existing `[implement]` Codex dispatcher |
| `default` | `codex-default` | shared `[codex]` fallback |

Do not expose `claude-implement`; that runtime does not exist in Phase 1. The current host Claude
or Codex session model is selected with the host's built-in `/model`, not through this command.

Print configured values returned by `status`. Explain the existing fallback resolution:
`codex-review` and `codex-dispatch` each fall back field-by-field to `codex-default`, then the SDK
default; `claude-review` uses its own backend/model/effort.

## Step 2 — dispatch on `$ARGUMENTS`

- Empty: print status and offer `claude`, `review`, `implement`, `default`, and `keep current`.
  If no picker exists, print typed usage and stop read-only.
- Typed form:
  `/sop-tier <review|implement|default|claude> [backend=<api|cli>] [effort=<value>] [model=<id or "">]`
- Require at least one assignment. Reject duplicate/unknown assignments before calling the tool.
- Codex effort domain: `""|minimal|low|medium|high|xhigh`; `backend` is forbidden.
- Claude effort domain: `""|low|medium|high|xhigh|max`; `backend` is optional.

Interactive choices must use the same domains. Empty string means provider/SDK default. Model ids
are opaque non-empty strings; do not invent model validation.

## Step 3 — one CAS mutation

Map the public scope through the table above and call once:

```json
{
  "action": "set-tier",
  "scope": "<machine scope>",
  "expected_config_sha256": "<sha from status>",
  "model": "<only if requested>",
  "effort": "<only if requested>",
  "backend": "<only for claude-review and only if requested>"
}
```

The server validates the provider-specific domain and changes only requested keys. On sha
mismatch, show refreshed read-only status and ask the user to retry; never silently replay.

## Step 4 — report

Print `changed_keys`, before/after sha, and backup path. Empty `changed_keys` means
`already set; nothing changed`. The next public bridge invocation re-reads config, so no reload is
needed after an ordinary tier mutation. Reconnect/restart is only for unavailable/changed bundle
or tool registration.
