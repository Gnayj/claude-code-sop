---
description: Show or set Codex and Claude reviewer model, effort, and backend tiers.
---

# /sop-tier — inspect or set Codex/Claude model, effort, and backend tiers

Work in `${CLAUDE_PROJECT_DIR}`. The typed-argument form is direct, deterministic, and scriptable.
The no-argument path prints status, then may offer an interactive selection. There are no flags
beyond the documented assignments.

## Step 0 — Guards

If `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, **abort**: the plugin root is an orphaned cache
snapshot created by a mid-session update. Tell the user to restart the session or reload plugins,
then re-run. Never auto-resolve to a sibling directory.

If `${CLAUDE_PROJECT_DIR}/.codex-review/config.toml` is missing, stop and say: "run `/sop-init`
first".

## Step 1 — Read state

Parse the config without rewriting it. Read these configured keys; commented or missing
model/effort keys equal `""`, while a commented or missing Claude backend equals `"api"`:

- `[codex] default_model` and `default_effort`
- `[review.codex] model` and `effort`
- `[implement] model` and `effort`
- `[review.claude] backend`, `model`, and `effort`

Resolve review model and effort independently through `[review.codex]` → `[codex]` → SDK default.
Resolve implement model and effort independently through `[implement]` → `[codex]` → SDK default.
Record the source of each resolved value. The `claude` scope has no `[codex]` fallback chain:
`[review.claude]` is its only configured source; an empty model selects the Claude backend's
strong default.

Validate effort against the chosen provider's distinct domain:

- Codex scopes (`review`, `implement`, `default`): `""`, `minimal`, `low`, `medium`, `high`, or
  `xhigh` — no `max`.
- Claude scope (`claude`): `""`, `low`, `medium`, `high`, `xhigh`, or `max` — no `minimal`.

The domains do not interoperate. For any other value, report its key and value, that the bridge
fails loud into its degraded path, and that a valid set repairs it. Status never repairs config.

## Step 2 — Dispatch on `$ARGUMENTS`

Trim whitespace, then:

- Empty: print the status template below. Offer a scope picker: `review`, `implement`, `default`
  (shared `[codex]` tier), `claude`, and `keep current`. Put each scope's current resolved model
  and effort in its label; include the current backend in the `claude` label. `keep current`
  stops without writing.
- For a picked Codex scope, offer effort choices `minimal`, `low`, `medium`, `high`, `xhigh`,
  `SDK default ("")`, and `keep current`. For `claude`, instead offer `low`, `medium`, `high`,
  `xhigh`, `max`, `SDK default ("")`, and `keep current`, then offer backend choices `api`, `cli`,
  and `keep current`. Offer Codex scopes model choices `keep current`, `SDK default ("")`, and a
  custom model id through free-text input; for `claude`, label `""` as the strong Claude default
  instead. Mark current configured values and consolidate the choices into one Step 3 write.
- If no interactive selection surface is available, print the typed-form usage and stop.
- Typed form: accept `review`, `implement`, or `default`, followed by `effort=<value>` and/or
  `model=<value>`; accept `claude` followed by any of `backend=<api|cli>`, `effort=<value>`, and
  `model=<value>`. Quoted `""` means the empty string. Model ids are any non-empty strings; do
  not validate their semantics.
- Require at least one assignment. Before any write, reject an unknown scope, unknown key,
  duplicate assignment, `backend` outside `api|cli` (or used outside `claude`), or effort outside
  its scope's provider-specific enum. Print the usage plus a validation note and make zero writes.

Status output:

```text
Configured:
[codex] default_model=<value> default_effort=<value>
[review.codex] model=<value> effort=<value>
[implement] model=<value> effort=<value>
[review.claude] backend=<value> model=<value> effort=<value>
Resolved:
review: effort=<value|SDK default> (from <review.codex|codex|SDK default>), model=<value|SDK default> (from <review.codex|codex|SDK default>)
implement: effort=<value|SDK default> (from <implement|codex|SDK default>), model=<value|SDK default> (from <implement|codex|SDK default>)
```

Usage:

```text
Usage: /sop-tier <review|implement|default|claude> [backend=<api|cli>] [effort=<value>] [model=<id or "">]
Codex scopes effort: <""|minimal|low|medium|high|xhigh>; backend is not accepted.
Claude scope effort: <""|low|medium|high|xhigh|max>; backend is optional.
```

## Step 3 — Set

Make targeted, comment-preserving line edits only in
`${CLAUDE_PROJECT_DIR}/.codex-review/config.toml`. Map the chosen scope to exactly these keys:

- `default`: `[codex] default_model` and `default_effort`
- `review`: `[review.codex] model` and `effort`
- `implement`: `[implement] model` and `effort`
- `claude`: `[review.claude] backend`, `model`, and `effort` (`backend` accepts only `api` or `cli`)

Write only requested assignments: at most the two allowed keys for a Codex scope or the three
allowed keys for `claude`. Uncomment or update their existing lines. Append a missing key to its
section, or append the section and key when the section is absent, matching the file's comment
style. Never reformat unrelated content or touch `[implement].enabled`, collaboration owner keys,
`[review] provider`, or any other key.

If every requested key already matches, say "already set; nothing changed" and do not write.
Otherwise make one consolidated write. When a valid effort replaces an invalid existing effort,
report that it was repaired.

## Step 4 — Report

Print a diff-style summary containing exactly the changed key lines. After any write, remind:
"run `/reload-plugins` or restart — the bridge loads config at startup only".
