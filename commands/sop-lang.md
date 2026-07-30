---
description: Re-materialize the ccsop-owned docs in another language (e.g. /sop-lang zh) via the placeholder-protection translation pipeline — machine-stable surfaces are preserved verbatim, only prose is translated, with 1:1 placeholder-restore verification and atomic write. Goes through the manifest; never touches owner=overlay.
---

# /sop-lang <lang> — re-materialize ccsop-owned docs in another language

Translate-once, in place. Plugin root = `${CLAUDE_PLUGIN_ROOT}`; target = `${CLAUDE_PROJECT_DIR}`.
`$ARGUMENTS` = target language (e.g. `zh` or `de`), or `--check <lang>` (drift report). The canonical source is always
the EN plugin template (via each manifest entry's `template_id`), not the currently-materialized file.

**Host task-tool guard (whole command):** the steps below are the complete execution plan. Do not
call any host task/todo-tracking tool, including but not limited to `TaskCreate`, `TaskUpdate`,
`TaskList`, `TaskGet`, and `TodoWrite`, and do not discover such a tool just to mirror this plan.
These tools are not required for language materialization and may be absent from the live
discovered-tool set. This command has no interactive decision point: do not call a user-question
tool. If the target-language argument is missing or invalid, report the usage/error and stop.

**Step 0 — orphaned-root guard**: if `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, abort (stale
cache snapshot; restart the session / reload plugins first). Never auto-resolve to a sibling dir.
Before resolving any Codex skill path/set, read
`${CLAUDE_PLUGIN_ROOT}/templates/control-surface/codex-skill-host-contract.md`; its
canonical/legacy roots and five-entry set are authoritative.

## Mode & source resolution (maintained-first)

See `docs/design/ccsop-framework/i18n-docs-design.md`. The exported
`MAINTAINED_LANGUAGE_ALIASES` table and `resolveLanguage` function in
`${CLAUDE_PLUGIN_ROOT}/mcp/codex-review/src/control-surface-contract.ts` are the machine authority.
Trim surrounding whitespace, use case-insensitive lookup with `_` converted to `-` for lookup only,
and preserve the trimmed spelling of valid unmaintained locales. The exact maintained aliases are
`zh` / `zh-CN` / `zh_CN` / `zh-Hans` / `zh_Hans` → **`zh-CN`** and
`de` / `de-DE` / `de_DE` → **`de-DE`**. Values such as `de-AT`, `de-CH`, `zh-Hant`, `zh-TW`,
`dee`, and `de-Latn` remain valid unmaintained locales; missing, empty, or grammar-invalid values
are invalid. Use a maintained canonical form for the manifest lookup, `--check`, copied artifacts,
and recorded `language` / `translation_source`.

**Translate mode** (`/sop-lang <lang>`) — resolve the source first:
- **Maintained language** — `${CLAUDE_PLUGIN_ROOT}/templates/i18n/<canonical-lang>/i18n-manifest.json` exists: **copy the
  vetted translated artifacts** for every in-scope target (record `translation_source=maintained` in the
  `.ccsop/manifest.json` entry). **All-or-nothing preflight**: resolve **every** in-scope target through the
  maintained manifest **before any write** (exactly one mapping each); any missing/ambiguous mapping →
  **abort the whole command with the missing-file list** (never silently mix with on-the-fly; per-entry
  continue is `/sop-update`-only). Exception: the single language-neutral
  `codex-scaffold/skills/simplify/references/contract.json` is verified from and copied byte-for-byte
  from the EN canonical, with no maintained-manifest lookup. The maintained-copy path is verbatim
  copying and **requires no
  translation provider**. On each **accepted successful** write, record `translation_source_sha` (the
  artifact's LF-normalized sha) alongside the other baselines **atomically** — never on preserved/failed
  entries; entries switched to `en`/`on-the-fly` **delete** the field. The seed/owner write
  policy below still applies (a consumer-modified seed file is preserved+warned, not overwritten).
- **Unmaintained language** — no such manifest: run the on-the-fly placeholder **Pipeline** below
  (`translation_source=on-the-fly`).

### Stable review-prompt seed reconciliation

Before any target write, enumerate the complete flow-independent set
`templates/review-prompts/*.tpl` and map it to
`.codex-review/templates/<same basename>`. All of them participate in a maintained language's
command-wide preflight; collaboration flow, owner, or implement enablement may not prune one.

Use the same owner-independent global prompt-namespace scan and exact classification as
`/sop-update` Step 1.A: candidates come from the direct target directory or either canonical /
v0.1.0 legacy source-ID prefix. Accept only the exact canonical path/ID pair or the exact
recognized legacy pair; reject unknown, mismatched, retired, out-of-directory, duplicate, or
canonical/legacy-collision states.

Unlike update, language materialization remains command-wide atomic. Treat recognized legacy IDs
as a staged metadata migration: change only
`review-prompts/<basename>` → `templates/review-prompts/<basename>` in the final command-wide
manifest postimage. Do not publish that normalization before every maintained mapping,
provider/translation precondition, render, and target write has succeeded. Any noncanonical or
ambiguous candidate aborts the whole command before any write with
`error (noncanonical prompt template_id)`. Correct an official entry to the exact canonical ID or
remove bogus provenance to clear the guard; `keep-local` / `owner=overlay` do not exempt it.

For a recognized legacy pristine target, normalize the ID, materialize the requested-language
content, and advance content baselines together in the final staged transaction. For a
modified/deleted target, preserve its bytes/deletion and every non-ID baseline field, but normalize
the ID in that same successful final transaction. This ID-only change is the sole explicit
metadata exception to “preserved entries keep every baseline unchanged”; any later command
failure leaves even the ID unchanged. An all-canonical second run emits no migration status and
remains plain `up-to-date`.

Handle each stable path once here and exclude it from the later generic manifest loop:

- target absent + entry absent: plugin-added seed; stage the requested-language render and full
  manifest entry, then atomically publish target + entry. Any failure removes the target and
  restores the manifest preimage.
- target present + entry absent: preserve bytes, add no entry, warn
  `preserved (untracked consumer seed)`.
- target absent + entry present: preserve the consumer deletion and entry bytes, warn
  `preserved (consumer deletion)`.
- target present + entry present: use the normal pristine/modified seed rule.

The new entry has the same complete field set as `/sop-update` Step 1.A, except `language` is the
canonical **requested language**, not the config's old language. Derive `translation_source` from
this run; a maintained copy must include `translation_source_sha`, while EN/on-the-fly omit it.
For a maintained language, any missing/ambiguous mapping or missing artifact aborts the whole
command before all writes. For an unmaintained language with no usable translation provider, the
existing provider precondition likewise aborts the whole command before all writes.

This is the sole narrow exception to the normal preserve-only rule for seeds with no pristine
baseline: only a stable review prompt with both target and entry absent may be atomically created.
Mark all stable paths handled before the generic pipeline; present/absent and absent/present remain
preserve-only.

**Normative review-prompt language matrix** (bound by
`mcp/codex-review/tests/review-prompt-seed-lifecycle.test.ts`):

| ID | input | exact outcome |
|---|---|---|
| L-RP1 | all mappings resolve; one target + entry absent | command-wide preflight passes; atomic new seed in requested language |
| L-RP2 | target present + entry absent | target hash unchanged; no entry; preserve + warn |
| L-RP3 | target absent + entry present | target remains absent; entry hash unchanged; preserve deletion + warn |
| L-RP4 | target + entry present | existing pristine/modified seed rule; handled once |
| L-RP5 | any maintained mapping missing/ambiguous | command-wide pre-write abort; all targets + manifest byte-identical |
| L-RP6 | unmaintained language + no provider | command-wide pre-write abort; all bytes unchanged |
| L-RP7 | second run after L-RP1 | target + manifest byte-identical; `up-to-date` |
| L-RP8 | unknown/mismatch/retired/out-of-directory noncanonical sibling | command-wide pre-write abort; all bytes unchanged |
| L-RP9 | exact recognized legacy + successful language command | ID normalization and requested-language changes publish in the command-wide final transaction; `legacy-template-id-migrated` |
| L-RP10 | recognized legacy + any language preflight failure | command-wide pre-write abort; ID, targets, and manifest all unchanged |
| L-RP11 | recognized legacy + preserved modified/deleted target | successful command changes only the ID; target and every non-ID baseline field unchanged |
| L-RP12 | duplicate path/source or canonical/legacy collision | command-wide pre-write abort; all bytes unchanged |
| L-DE3 | second successful `/sop-lang de` with pristine German Codex seeds | all maintained targets and manifest byte-identical; `canonical-language-up-to-date` |

Shared German alias/update outcomes `L-DE1`, `L-DE2`, and `L-DE4` are normative in
`/sop-update`'s lifecycle matrix. This command uses the same resolver; its maintained preflight
retains the command-wide abort behavior defined by L-RP5.

**`--check <lang>` mode** (drift report; **no writes**): for each entry in
`${CLAUDE_PLUGIN_ROOT}/templates/i18n/<canonical-lang>/i18n-manifest.json`, recompute the EN `source_path`'s
**LF-normalized** `sha256` and compare to the recorded `source_sha`:
- match → `in-sync`; mismatch → `DRIFTED: <target_rel> (EN <source_path> changed; re-translate + re-vet)`.
- Exit non-zero if any recorded file drifted. This remains a maintainer-facing local report and
  covers `README.<lang>.md`, but is no longer the public release gate. The current release truth is
  the drift+closure checker `scripts/check-i18n-manifest.mjs`, which `scripts/sync-public.sh`
  invokes against its stripped export target.

### Source handling by template origin (dispatch on `template_id`)
- **docs-scaffold files** (`templates/docs-scaffold/...` → `docs/...`, owner=ccsop) **except the `index.md`
  nav stubs (see seed below)**: translate via the Pipeline below.
- **nav/index stubs** (`docs/{methodology,design,runbooks,references}/index.md`, **owner=seed**): translate
  only if the current file is a **pristine prior render** (on-disk sha == manifest `rendered_sha`);
  consumer-populated (sha mismatch / no entry) → **preserve + warn**, do not translate over it.
- **review-prompt templates** (`templates/review-prompts/*.tpl` → `.codex-review/templates/*.tpl`, **owner=seed**):
  translate via the Pipeline below **only if a pristine prior render** (on-disk sha == `rendered_sha`); if the
  consumer customized it (sha mismatch / no entry) → **preserve + warn**, do not translate over it (`--force`
  does not override seed). Seed set is path-based (overrides any old `owner=ccsop`).
- **Codex-side scaffold** (`templates/codex-scaffold/skills/**` →
  `.agents/skills/**`, **owner=seed**; sop-init Step 3.A): process all five canonical skills and
  their references with the same pristine-only seed rule as review prompts. A
  consumer-modified/untracked canonical file is preserved+warned. Maintained prose lives under
  `templates/i18n/<canonical-lang>/codex-scaffold/**` and participates in the command-wide
  all-or-nothing preflight. `simplify/references/contract.json` is the single EN canonical machine
  artifact: copy those exact bytes for every language, never translate it, and do not require an
  i18n-manifest mapping for it. Never translate or mutate legacy `.codex/skills/**`; an unresolved
  legacy migration conflict stays untouched. Keep the JSON manifest entry
  `language="en"` / `translation_source="none(en)"`, with no `translation_source_sha`, regardless
  of the requested language. Re-render the repo-root AGENTS ccsop block from the
  translated snippet only when the canonical skill state is already valid; never translate the
  consumer's surrounding file.
- **review config** (`templates/config.toml.tpl` → `.codex-review/config.toml`, owner=ccsop): **NOT translated** — re-render from the template and set `[meta].language = <lang>` only. Values/keys are machine-stable; do not run it through prose translation. Update its manifest `rendered_sha`, but it is not a "translated entry".
- **owner=overlay** (`records/current.md`): never touched.

## Preconditions

- Read `.ccsop/manifest.json` (run `/sop-init` first if absent).
- **Provider prerequisite — on-the-fly branch ONLY** (the **maintained** branch is verbatim copying
  and needs no translation provider; it MUST proceed regardless of `translation.provider`):
  when (and only when) the target language is **unmaintained**, determine `translation.provider`
  from `.codex-review/config.toml`:
  - `claude` → use it to translate prose.
  - `none` / unset, or `review.provider = manual` → **on-the-fly translation is unsupported**: tell
    the user to bring their own translated templates or set `translation.provider`, and stop. Never
    borrow the review model to translate.

**Consumer extension blocks** (Markdown managed docs only — `commands/sop-update.md` Step 2.A):
before any pristine check or write, parse+validate blocks (fail-closed: malformed set ⇒ file +
manifest entry untouched + blocking warning), extract + strip, run the pristine check **on stripped
content**, then re-insert the blocks (never translated, payload bytes immutable) into the new
render per the anchor rule, single atomic write.

## Pipeline (per translatable file — owner=ccsop docs-scaffold + **pristine** owner=seed nav/index stubs & review-prompts; config is re-rendered per above; **a modified/untracked seed entry — **effective** LF-normalized sha ≠ `rendered_sha` (effective = stripped-of-valid-consumer-blocks for eligible Markdown, raw otherwise; fail-closed on malformed blocks) — is preserved+warned, never translated, even with `--force`**; owner=overlay is NEVER translated)

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

- Per entry, **only after an accepted successful write**, advance ALL baselines **atomically**:
  `source_sha` + `rendered_sha` + `language` + `translation_source` + `version`, **plus
  `translation_source_sha`** (the maintained artifact's LF-normalized sha) for maintained copies;
  **delete** `translation_source_sha` when the entry becomes `en` / `on-the-fly`. Entries that were
  preserved, aborted, or failed keep every **content** baseline unchanged (the pending change
  resurfaces on the next run). The single metadata exception is recognized-legacy `template_id`
  normalization published with a successful command-wide transaction; see the stable
  review-prompt seed reconciliation section and L-RP11.
- Re-render `.codex-review/config.toml` `[meta].language` to `<lang>`.
- Confirm with the user before overwriting (show which files change); honor `--force` to skip the prompt.

## Boundaries
- owner=ccsop files + **pristine** owner=seed entries only; a **modified/untracked** seed entry
  (**effective** LF-normalized sha ≠ `rendered_sha` — stripped content for block-eligible Markdown,
  raw otherwise) is preserved+warned, never translated over (even with `--force`);
  `records/current.md` and user-converted overlay files are never translated.
- **Narrow stable-seed exception**: before the generic pipeline, a current review-prompt seed whose
  target AND manifest entry are both absent may be atomically created in the requested language
  with its full entry. Mark all stable paths handled. Target-present / entry-absent and
  target-absent / entry-present remain preserve-only; all other untracked/modified seeds stay
  off-limits.
- Translate from the EN canonical, not the already-materialized language (avoid compounding drift).
- Step-4 verification failure aborts that file with no write — never ship a half-translated doc.
