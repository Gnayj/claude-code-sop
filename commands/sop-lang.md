---
description: Re-materialize the ccsop-owned docs in another language (e.g. /sop-lang zh) via the placeholder-protection translation pipeline — machine-stable surfaces are preserved verbatim, only prose is translated, with 1:1 placeholder-restore verification and atomic write. Goes through the manifest; never touches owner=overlay.
---

# /sop-lang <lang> — re-materialize ccsop-owned docs in another language

Translate-once, in place. Plugin root = `${CLAUDE_PLUGIN_ROOT}`; target = `${CLAUDE_PROJECT_DIR}`.
`$ARGUMENTS` = target language (e.g. `zh`). The canonical source is always the EN plugin template
(via each manifest entry's `template_id`), not the currently-materialized file.

### Source handling by template origin (dispatch on `template_id`)
- **docs-scaffold files** (`templates/docs-scaffold/...` → `docs/...`, owner=ccsop): translate via the Pipeline below.
- **review-prompt templates** (`templates/review-prompts/*.tpl` → `.codex-review/templates/*.tpl`, owner=ccsop): translate via the Pipeline below (prose + masked schema/enums).
- **review config** (`templates/config.toml.tpl` → `.codex-review/config.toml`, owner=ccsop): **NOT translated** — re-render from the template and set `[meta].language = <lang>` only. Values/keys are machine-stable; do not run it through prose translation. Update its manifest `rendered_sha`, but it is not a "translated entry".
- **owner=overlay** (`records/current.md`): never touched.

## Preconditions

- Read `.ccsop/manifest.json` (run `/sop-init` first if absent).
- Determine `translation.provider` from `.codex-review/config.toml`:
  - `claude` → use it to translate prose.
  - `none` / unset, or `review.provider = manual` → **translation is unsupported**: tell the user to
    bring their own translated templates or set `translation.provider`, and stop. Never borrow the
    review model to translate.

## Pipeline (per translatable owner=ccsop file — docs-scaffold + review-prompts; config is re-rendered per above; owner=overlay is NEVER translated)

Run this 5-step placeholder-protection pipeline; **abort the whole file atomically if step 4 fails**
(leave the existing file untouched — no half-translated output):

1. **Mask** every machine-stable surface in the EN canonical with an opaque placeholder
   (e.g. `⟦P0⟧`, `⟦P1⟧`, …), recording the placeholder→original map.
2. **Translate** only the remaining prose to `<lang>` via `translation.provider`.
3. **Restore** every placeholder from the map.
4. **Verify** 1:1: every placeholder was emitted exactly once and restored; the set of restored
   originals equals the masked set. If any mismatch → **abort this file**, report, do not write.
5. **Atomic write**: write to a temp file, then rename over the target (no partial state).

### Machine-stable surface whitelist (mask in step 1, never translate)
- verdict enums: `Go` / `Go-after-fixes` / `Rereview-after-fixes` / `No-Go` / `Pass` /
  `Pass-after-fixes` / `All-fixed` / `Partial` / `New-issues`
- `§`-section ids and the 9.A–9.E labels
- config keys / TOML table names / JSON schema keys
- env var names, command names (e.g. `/sop-init`, `codex_code_review`)
- file paths, Markdown link targets
- agent frontmatter field names (`name` / `description` / `tools` / `model` / `effort`)
- field names + values: **`code-home:`** and its 6 legal values (incl. `(unmerged)`), `design_id`
- `${...}` placeholders

## After translation

- Update each translated entry's `language` + `rendered_sha` in the manifest.
- Re-render `.codex-review/config.toml` `[meta].language` to `<lang>`.
- Confirm with the user before overwriting (show which files change); honor `--force` to skip the prompt.

## Boundaries
- owner=ccsop files only; `records/current.md` and user-converted overlay files are never translated.
- Translate from the EN canonical, not the already-materialized language (avoid compounding drift).
- Step-4 verification failure aborts that file with no write — never ship a half-translated doc.
