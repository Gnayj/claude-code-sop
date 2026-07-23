---
description: Incrementally update the ccsop-owned scaffolded files (methodology docs, task templates, review config) to the current plugin version. Updates owner=ccsop files and re-renders only pristine owner=seed entries (nav/index stubs + review prompts); reports conflicts on locally-edited files instead of overwriting; never touches owner=overlay or modified owner=seed (your records/current.md + consumer-populated nav/prompts).
---

# /sop-update — incremental update of ccsop-owned files

This is the single-source repair loop: ccsop-owned generic files are re-materialized from the
plugin; local breakpoint/overlay files are never touched. Plugin root = `${CLAUDE_PLUGIN_ROOT}`;
target repo = `${CLAUDE_PROJECT_DIR}`. `$ARGUMENTS` may contain `--force` and/or a path filter.

## Step 0 — Orphaned-root guard

If `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, **abort immediately**: the resolved plugin root is
an orphaned cache snapshot (the plugin was updated mid-session and the harness still points at the
old dir). Comparing against it silently reports everything `up-to-date` against a stale version.
Tell the user: "plugin root is an orphaned snapshot — restart the session / reload plugins, then
re-run /sop-update." Do **not** auto-resolve to a sibling live directory.

## Step 1 — Read the manifest

Read `.ccsop/manifest.json`. If absent, tell the user to run `/sop-init` first and stop.

## Step 2 — Per managed entry, detect local edits

**Effective comparison content first (shared by all branches, computed BEFORE any owner
classification)**: for every entry, derive the content that all sha comparisons use:
1. For an **extension-block-eligible Markdown** file (Step 2.A class): parse + validate consumer
   blocks (**fail-closed**: a malformed block set ⇒ that file + manifest entry untouched + blocking
   warning, skip the entry), then **strip valid blocks** — the effective content is the stripped
   text. A file whose only delta is valid consumer blocks is therefore *pristine* (normative
   fixture 12a).
2. For every other file: the raw on-disk content.
Then LF-normalize (CRLF → LF before hashing, matching how `rendered_sha` was computed — so an
`autocrlf` re-checkout doesn't false-flag a file as locally-edited, F3) and `sha256`. **All sha
comparisons below (both `owner=ccsop` and `owner=seed`) use this effective LF-normalized sha.**

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
  locally, there is nothing to do — record `up-to-date`. **Exception — maintained-language entries
  (translation-aware criterion)**: for an entry with `translation_source=maintained`, `up-to-date`
  additionally requires the **maintained artifact** to be unchanged:
  - Resolve the maintained artifact via the language's
    `${CLAUDE_PLUGIN_ROOT}/templates/i18n/<canonical-lang>/i18n-manifest.json`: the entry whose
    `source_path` equals this entry's `template_id`; its `target_rel` is the artifact path. Missing
    or ambiguous (≠1 match) ⇒ **abort this entry with an explicit error and continue with the
    others** (per-entry abort is `/sop-update`-only; `/sop-init` and `/sop-lang` keep their
    command-wide all-or-nothing preflight).
  - Compare the artifact's LF-normalized sha to the entry's **`translation_source_sha`**; a changed
    artifact with an unchanged EN `source_sha` = a translation-only revision ⇒ **update available**
    (same re-render + conflict rules as any update).
  - **Back-compat** (legacy entry without `translation_source_sha`): compare the artifact's sha to
    the recorded `rendered_sha` (maintained copies are verbatim at render time; equal ⇒ up-to-date);
    on mismatch ⇒ update available. Write the new field at the next successful render.
  - **Baseline advancement is atomic and success-only**: `source_sha` / `translation_source_sha` /
    `rendered_sha` / `language` / `translation_source` / `version` advance together, **only after an
    accepted successful pure render is written** — never on keep-local, preserved, a failed atomic
    render, or an unresolved conflict (the update resurfaces on every later run until resolved).
    Switching an entry to `en` or `on-the-fly` **deletes** `translation_source_sha`.

## Step 2.A — Consumer extension blocks (Markdown managed docs only)

Consumers may keep project-owned content inside ccsop-managed files via **extension blocks**, which
survive re-renders. Honored ONLY in Markdown managed documents (`owner=ccsop` `docs/**/*.md` +
pristine `owner=seed` `docs/**/index.md` stubs). In any other managed file (`config.toml`, JSON,
`.gitattributes`, review-prompt `.tpl`s, the `AGENTS.md` ccsop block) marker-looking text is treated
as a plain local edit — never stripped.

**Marker grammar** (each marker a standalone line, exact match):
```
<!-- consumer:begin <slug> anchor="<token>" -->
…consumer content (never modified, never translated, never diffed)…
<!-- consumer:end <slug> -->
```
- `<slug>` = `[a-z0-9-]{1,64}`, unique per file. Markers inside fenced code blocks (track ``` / ~~~)
  are content, not markers. No nesting, no overlap.
- **Fail-closed**: duplicate slug, missing/mismatched end, overlap, or an end without a begin ⇒
  leave that file **and its manifest entry byte-for-byte untouched**, emit a blocking warning naming
  the file + violation, continue with other files. An invalid block set can never trigger a
  strip/render/re-insert.

**Anchor identity** — language-neutral + persistent:
- `anchor` = the **leading section-number token** of a heading (e.g. `9.C`, `4.1`) — invariant
  across EN/zh renders (both `### 9.C Module-specific checklist` and `### 9.C 模块特定清单` carry it).
- Consumer payload bytes are **immutable**; begin-marker **metadata may be enriched exactly once**:
  a block missing the attr gets it derived from the nearest preceding numbered heading (else
  `anchor="EOF"`) and written into the marker as an **independent atomic migration write** — this
  runs even when the entry is otherwise `up-to-date` (status `anchor-migrated`; `rendered_sha`
  stays the pure-render hash).
- **Re-insert rule**: insert at the **end of the anchor section** — immediately before the next
  heading whose level is **equal to or higher than the anchor heading's**, or at EOF. Same-anchor
  blocks keep their original relative order. A duplicate section token in a render ⇒ fail-closed
  (as malformed). If the token is absent from the new render ⇒ append at EOF + warn, **keeping the
  declared `anchor` unchanged** (a later render that regains the heading re-anchors it).

**Algorithm** per eligible file: parse+validate blocks (fail-closed) → extract → strip → run the
Step 2 pristine/local-edit detection **on the stripped content** vs `rendered_sha` (semantics
unchanged: sha of the pure render) → re-render → re-insert per anchor rule → **single atomic
write**. Edits only *inside* blocks therefore keep a file update-eligible; edits outside blocks are
local edits as before.

**Normative behavioral matrix** (spec fixtures — expected file bytes / manifest / status per case):
see the design doc `docs/design/ccsop-framework/dogfood-r2-fixes-design.md §8.A` (cases 1–16),
which binds this command: translation-only updates (new + legacy manifest), keep-local retention,
outside-block edit conflict, block preservation, in-block-only edits, malformed markers
(fail-closed), EOF-fallback + later re-anchor, anchor migration, ineligible files, seed with
blocks-only delta (updatable) vs outside-block edit (preserved), language switch (field deleted),
per-entry vs all-or-nothing resolution aborts, orphaned-root hard abort.

## Step 3 — `--force`

`--force` takes `accept-new` for all **`owner=ccsop`** conflicts (still backing up each `<file>.ccsop-bak`
first). Even with `--force`, **`overlay` paths and modified `seed` paths are never overwritten** (seed is
consumer-owned; only a pristine seed entry may be re-rendered).

## Step 4 — Finish

- Print a per-file summary: `updated` / `updated (N blocks preserved)` / `up-to-date` /
  `anchor-migrated` / `conflict (choice)` / `preserved (consumer-owned)` / `overlay-skipped` /
  `error (unresolvable maintained mapping)` / blocking warnings (malformed extension blocks).
- If any methodology rule changed, remind the user the change came from the plugin (single source);
  project-specific overrides should live in runbooks / overlay, not by editing owner=ccsop files.

## Boundaries
- `owner=ccsop` files + **pristine** `owner=seed` entries (re-render only on **effective**
  LF-normalized sha match — stripped-of-valid-consumer-blocks for eligible Markdown, raw otherwise;
  see Step 2 preamble). A **modified/untracked** `owner=seed` entry, `records/current.md`
  (owner=overlay), and any user-converted overlay file are off-limits (not overwritten, even with `--force`).
- Never overwrite a locally-edited file without an explicit per-file choice or `--force` (+ backup).
- Resetting the breakpoint is a separate explicit action (`--reset-breakpoint`), not part of update.
