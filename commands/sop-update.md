---
description: Incrementally update the ccsop-owned scaffolded files (methodology docs, task templates, review config) to the current plugin version. Updates owner=ccsop files and re-renders only pristine owner=seed entries (nav/index stubs + review prompts); reports conflicts on locally-edited files instead of overwriting; never touches owner=overlay or modified owner=seed (your records/current.md + consumer-populated nav/prompts).
---

# /sop-update — incremental update of ccsop-owned files

This is the single-source repair loop: ccsop-owned generic files are re-materialized from the
plugin; local breakpoint/overlay files are never touched. Plugin root = `${CLAUDE_PLUGIN_ROOT}`;
target repo = `${CLAUDE_PROJECT_DIR}`. `$ARGUMENTS` may contain `--force` and/or a path filter.

## Step 1 — Read the manifest

Read `.ccsop/manifest.json`. If absent, tell the user to run `/sop-init` first and stop.

## Step 2 — Per managed entry, detect local edits

**LF-normalized sha first (shared by all branches)**: for every entry, compute the on-disk file's current
`sha256` over **LF-normalized** content (convert CRLF → LF before hashing), matching how `rendered_sha` was
computed — so an `autocrlf` re-checkout doesn't false-flag a file as locally-edited (F3). **All sha
comparisons below (both `owner=ccsop` and `owner=seed`) use this LF-normalized sha.**

**Path-based seed override**: treat any path in the **seed set** (matched on the normalized
target-repo path) — `docs/{methodology,design,runbooks,references}/index.md` + `.codex-review/templates/*.tpl`
+ the codex-side skill `.codex/skills/project-sop/SKILL.md` (flow-matrix scaffold, sop-init Step 3.A)
— as **`owner=seed`**, **even if an older manifest entry still says `owner=ccsop`** (back-compat for consumers
adopted before this fix). (The repo-root `AGENTS.md` ccsop **block** is `owner=ccsop` but block-scoped:
update only the ccsop-managed block, never the consumer's surrounding content.)

For each `owner == "seed"` entry / seed-set path:
- **pristine** (LF-normalized on-disk sha == `rendered_sha`): safe to re-render (same as the ccsop pristine path below).
- **modified, or no manifest entry / no `rendered_sha`** (no trustworthy pristine baseline): **preserve + warn**
  — record `preserved (consumer-owned)`; do NOT overwrite. `--force` does NOT override this (seed is
  consumer-owned). Offer `convert-to-overlay` if the user wants ccsop to stop tracking it entirely.

For each entry with `owner == "ccsop"` (skip `owner == "overlay"` entirely):
- compare the LF-normalized on-disk sha (from the Step 2 preamble) to the manifest's `rendered_sha`:
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

`--force` takes `accept-new` for all **`owner=ccsop`** conflicts (still backing up each `<file>.ccsop-bak`
first). Even with `--force`, **`overlay` paths and modified `seed` paths are never overwritten** (seed is
consumer-owned; only a pristine seed entry may be re-rendered).

## Step 4 — Finish

- Print a per-file summary: `updated` / `up-to-date` / `conflict (choice)` / `preserved (consumer-owned)` / `overlay-skipped`.
- If any methodology rule changed, remind the user the change came from the plugin (single source);
  project-specific overrides should live in runbooks / overlay, not by editing owner=ccsop files.

## Boundaries
- `owner=ccsop` files + **pristine** `owner=seed` entries (re-render only on LF-normalized sha match). A
  **modified/untracked** `owner=seed` entry, `records/current.md` (owner=overlay), and any user-converted
  overlay file are off-limits (not overwritten, even with `--force`).
- Never overwrite a locally-edited file without an explicit per-file choice or `--force` (+ backup).
- Resetting the breakpoint is a separate explicit action (`--reset-breakpoint`), not part of update.
