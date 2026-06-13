---
description: Incrementally update the ccsop-owned scaffolded files (methodology docs, task templates, nav stubs, review config/prompts) to the current plugin version. Only touches owner=ccsop files; reports conflicts on locally-edited files instead of overwriting; never touches owner=overlay (your records/current.md).
---

# /sop-update — incremental update of ccsop-owned files

This is the single-source repair loop: ccsop-owned generic files are re-materialized from the
plugin; local breakpoint/overlay files are never touched. Plugin root = `${CLAUDE_PLUGIN_ROOT}`;
target repo = `${CLAUDE_PROJECT_DIR}`. `$ARGUMENTS` may contain `--force` and/or a path filter.

## Step 1 — Read the manifest

Read `.ccsop/manifest.json`. If absent, tell the user to run `/sop-init` first and stop.

## Step 2 — Per owner=ccsop entry, detect local edits

For each entry with `owner == "ccsop"` (skip `owner == "overlay"` entirely):
- compute the current on-disk file's `sha256`.
- compare to the manifest's `rendered_sha`:
  - **unchanged locally** (on-disk sha == rendered_sha): safe to update. Re-render the current
    plugin template (in the entry's `language`, through the §4.3 pipeline if not en), write it,
    and update the entry's `source_sha` + `rendered_sha` + `version`. Record `updated`.
  - **changed locally** (on-disk sha != rendered_sha): **conflict — do NOT overwrite**. Report:
    the file, a diff (current vs the new plugin render), and three options:
    1. **keep-local**: leave as-is (record that it has diverged);
    2. **convert-to-overlay**: flip `owner` to `overlay` (ccsop stops managing it; the user owns it long-term);
    3. **accept-new**: take the new render (back up `<file>.ccsop-bak` first), update the manifest.
    Wait for the user's choice per file; do not auto-resolve.
- If the plugin template `source_sha` is unchanged from the manifest AND the file is unchanged
  locally, there is nothing to do — record `up-to-date`.

## Step 3 — `--force`

`--force` takes `accept-new` for all conflicts (still backing up each `<file>.ccsop-bak` first).
Even with `--force`, **overlay paths are never touched**.

## Step 4 — Finish

- Print a per-file summary: `updated` / `up-to-date` / `conflict (choice)` / `overlay-skipped`.
- If any methodology rule changed, remind the user the change came from the plugin (single source);
  project-specific overrides should live in runbooks / overlay, not by editing owner=ccsop files.

## Boundaries
- Only owner=ccsop files. `records/current.md` (owner=overlay) and any user-converted overlay file are off-limits.
- Never overwrite a locally-edited file without an explicit per-file choice or `--force` (+ backup).
- Resetting the breakpoint is a separate explicit action (`--reset-breakpoint`), not part of update.
