---
description: Show or set the standing ccsop collaboration flow for Claude-driven work.
---

# /sop-flow — inspect or switch the collaboration flow

Work in `${CLAUDE_PROJECT_DIR}`. The typed-argument form is direct, deterministic, and scriptable.
The no-argument path prints status, then may offer an interactive selection. The set flow itself
asks no wizard questions: one pick maps to one action, equivalent to the single argument. There
are no flags.

## Step 0 — Guards

If `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, **abort**: the plugin root is an orphaned cache
snapshot created by a mid-session update. Tell the user to restart the session or reload plugins,
then re-run. Never auto-resolve to a sibling directory.

If `${CLAUDE_PROJECT_DIR}/.codex-review/config.toml` is missing, stop and say: "run `/sop-init`
first".

## Step 1 — Read state

Parse the config without rewriting it. In every state, read:

- `[collaboration] design_owner` and `implement_owner`, including whether each is present.
  Commented keys are absent; an individually absent owner resolves to `claude`.
- `[implement] enabled`.
- `[review] provider`, including for explicit flows.

Classify the owner state:

- **legacy**: both owner keys are absent; `review.provider` governs every stage.
- **explicit `<design>+<implement>`**: resolve an individually absent owner as above; each value
  must be `claude` or `codex`.
- **invalid**: either present owner has another value. Report the invalid key/value and that the
  bridge fails loud into its degraded path rather than silently choosing a reviewer. Status must
  not repair it; say that a valid set argument writes both owner keys and the coupled implement
  gate.

## Step 2 — Dispatch on `$ARGUMENTS`

Trim whitespace, then:

- Empty: print the status template below, then offer an interactive selection with exactly three
  options: `claude+claude`, `claude+codex`, and `keep current`. Mark the active flow in its option
  label. A flow pick continues to Step 3 exactly as if that flow were passed as the argument.
  `keep current` stops with no write. If no interactive selection surface is available, print the
  two set commands from the status template and stop (the v1 fallback).
- `claude+claude` or `claude+codex`: continue to Step 3.
- `codex+codex` or `codex+claude`: reject without writing. Explain that the driving CLI is the
  `design_owner` CLI (collaboration.md §1.D rule 2), so Codex-driven flows must be switched from
  the Codex side. Point to the `codex-scaffold` skill and the repository `AGENTS.md`.
- Anything else: print `Usage: /sop-flow [claude+claude|claude+codex]` and stop.

Status output:

```text
Flow: <design_owner>+<implement_owner>
Design review: <counterpart(design_owner)>
Code review: <counterpart(implement_owner)>
Fix review: inherits the reviewer recorded for that review session
[implement].enabled: <true|false>
Per-session override: "这单走 <flow>" / "this one <flow>"
Set standing default: /sop-flow claude+claude | /sop-flow claude+codex
```

For legacy state, replace the flow and reviewer lines with:

```text
Flow: legacy — review.provider=<value> governs all stages
```

For invalid state, show the invalid diagnosis from Step 1 instead of claiming an effective flow.
When `review.provider = manual` and owner keys are present, show the resolved flow owners, then:

```text
Delivery: manual for every stage (you forward to the derived counterpart)
```

Do not print an automatic-reviewer table in that manual case. Otherwise, derive design review as
`counterpart(design_owner)`, code review as `counterpart(implement_owner)`, and fix review from the
reviewer's kind recorded in that session.

## Step 3 — Set the standing default

Make targeted, comment-preserving line edits only in
`${CLAUDE_PROJECT_DIR}/.codex-review/config.toml`:

1. In the existing `[collaboration]` section, uncomment or update `design_owner` and
   `implement_owner` to the requested values. Append that section only if it is wholly absent.
2. For `claude+codex`, set `[implement] enabled = true`.
3. For `claude+claude`, change `[implement] enabled` from `true` to `false`. On that edge always
   say: "disabled codex_implement — not used by this flow; re-enable manually if you meant to keep
   it". If it is already false, leave it unchanged.
4. If `[implement]` is absent when its target key must be written, append the section.

The complete target state is the two owner keys plus the coupled `[implement].enabled` value
(`true` for `claude+codex`, `false` for `claude+claude`). Repair invalid owner values on a valid set
and report the repair. Never change more than these three keys, reformat unrelated content, or
touch `[review] provider`. If that provider is `manual`, note that delivery remains manual for
every stage. Writing explicit owner keys activates per-stage derivation: warn when a non-manual
`review.provider` is set that it no longer selects reviewers (derivation wins — §1.D precedence).

## Step 4 — Report

Print a diff-style summary containing exactly the changed key lines. After any write, remind:
"run `/reload-plugins` or restart — the bridge loads config at startup only".

Say "already active; nothing changed" only when all three keys already match the complete target
state. Owner matches alone are not idempotence: explicit `claude+claude` with `enabled = true`
must still write `enabled = false`, print the disable notice, include that line in the summary,
and print the reload reminder.
