---
description: Incrementally update the ccsop-owned scaffolded files (methodology docs, task templates, review config) to the current plugin version. Updates owner=ccsop files and re-renders only pristine owner=seed entries (nav/index stubs + review prompts); reports conflicts on locally-edited files instead of overwriting; never touches owner=overlay or modified owner=seed (your records/current.md + consumer-populated nav/prompts).
---

# /sop-update — incremental update of ccsop-owned files

This is the single-source repair loop: ccsop-owned generic files are re-materialized from the
plugin; local breakpoint/overlay files are never touched. Plugin root = `${CLAUDE_PLUGIN_ROOT}`;
target repo = `${CLAUDE_PROJECT_DIR}`. `$ARGUMENTS` may contain `--force`, a path filter, or the
exclusive migration action `--rollback-codex-skills`.

## Step 0 — Orphaned-root guard

If `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, **abort immediately**: the resolved plugin root is
an orphaned cache snapshot (the plugin was updated mid-session and the harness still points at the
old dir). Comparing against it silently reports everything `up-to-date` against a stale version.
Tell the user: "plugin root is an orphaned snapshot — restart the session / reload plugins, then
re-run /sop-update." Do **not** auto-resolve to a sibling live directory.

Before any Codex skill lifecycle decision, read
`${CLAUDE_PLUGIN_ROOT}/templates/control-surface/codex-skill-host-contract.md`. Its minimum CLI,
canonical/legacy roots, five-entry set, preserve-only gate behavior, and rollback flag are the
machine-derived authority; do not reconstruct those facts from this prose.

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
+ every canonical `.agents/skills/**` file (Codex scaffold, sop-init Step 3.A)
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

## Step 2.B — permission-baseline merge + backfill (`.claude/settings.json`)

`.claude/settings.json` is `owner=ccsop` but consumers legitimately EXTEND it (project Bash allows,
etc.), so it must **never** go through the generic whole-file re-render (that would destroy consumer
rules). It gets a dedicated **merge** path, and — because the census found most adopted repos have a
`.claude/settings.json` with **no** `permission-baseline:*` manifest entry at all — a **backfill**
path (design `bridge-deps-lifecycle-design.md` §4.2).

**Managed subset = `permissions.allow` only.** Every other JSON key, and every `permissions.allow`
entry the template does not own, is out of scope and passes through byte-identical.

**Canonical set** (from `${CLAUDE_PLUGIN_ROOT}/templates/permission-baseline.json`):
`mcp__plugin_ccsop_ccsop-review__codex_design_review`, `…__codex_code_review`, `…__codex_fix_review`.

**Superseded names to migrate** (ccsop-owned, replaced by the canonical set — remove on sight):
- bare `mcp__ccsop-review__codex_{design,code,fix}_review` (0.1.0-era, pre-plugin-prefix);
- any wildcard `mcp__plugin_ccsop_ccsop-review__*` or `mcp__ccsop-review__*` (over-broad — it grants
  `codex_implement`; replace with the enumerated three).

**Merge algorithm** (entry present OR backfill):
1. Read `.claude/settings.json`. **Invalid JSON ⇒ fail closed**: leave the file + manifest entry
   untouched, emit a blocking warning naming the file, continue with other entries (never partial-write).
2. Compute the new `permissions.allow`: drop every superseded name; ensure the canonical three are
   present; **preserve all other entries in their original order**; **de-dupe** keeping first
   occurrence (stable). Append any missing canonical names after the last preserved entry.
3. If the resulting `permissions.allow` (and thus the file) is byte-identical to the current one AND
   the manifest entry already exists ⇒ status `up-to-date` (idempotent no-op — no sha churn).
4. Otherwise write the merged file (single atomic write) and set the manifest entry:
   `source_sha` = the template's LF-normalized sha, `rendered_sha` = the **merged file's**
   LF-normalized sha (NOT the template's — the preserved consumer rules mean the two differ, and
   using the template sha would flag the file as a permanent local edit).

**Backfill** (`.claude/settings.json` exists but manifest lacks `permission-baseline:<provider>`):
run the same merge, then **append** the manifest entry (`template_id: "permission-baseline:<provider>"`
using the repo's `review.provider`, `owner=ccsop`, `path: ".claude/settings.json"`, the two sha
fields as above). This adopts a previously-unmanaged file through the merge path — never a blind write.

**Never** overwrite the whole file; **never** honor `--force` as accept-new here (merge is the only
mode — there is nothing to whole-file-replace). Status values: `updated (permissions merged)` /
`up-to-date` / `backfilled (manifest entry added)` / `error (invalid settings.json)`.

**Normative behavioral matrix** (spec fixtures — expected `permissions.allow` bytes + manifest +
status per case), which binds this command:

| # | input state | expected outcome |
|---|---|---|
| B1 | orphan entry + stale bare names + consumer allows | bare `mcp__ccsop-review__*` → canonical three; consumer allows preserved in order; status `updated` |
| B2 | settings.json present, NO manifest entry, canonical three already present + consumer allows | file unchanged; manifest entry appended; status `backfilled` |
| B3 | settings.json present, NO manifest entry, stale bare names | migrate → canonical + append manifest entry; status `backfilled` |
| B4 | already-canonical + entry present | `up-to-date`; no sha churn (idempotent) |
| B5 | second `/sop-update` after B1/B2/B3 | `up-to-date` (idempotent; no duplicate entries) |
| B6 | wildcard `…ccsop-review__*` present | replaced by the enumerated three (no `codex_implement` grant) |
| B7 | invalid JSON | file + entry untouched; status `error`; blocking warning; other entries continue |
| B8 | unrelated top-level keys + non-ccsop `permissions.allow` entries | all survive byte-identical |

## Step 2.C — Codex canonical skill lifecycle

Run this scoped lifecycle only when the config/flow uses Codex or legacy
`.codex/skills/project-sop/SKILL.md` exists. A Claude-only consumer with neither condition records
`skipped (Codex not in use)` and does not require a Codex CLI.

1. Parse `codex --version` with standard semver prerelease ordering. Require the host-contract
   minimum (`>=0.145.0-alpha.2` in contract v1); `alpha.1`, missing, or unparseable keeps legacy
   bytes, manifest, and AGENTS
   pointer unchanged and records a scoped informational conflict. Do not create a duplicate
   canonical skill tree. If a prior verified migration already left canonical-only state, preserve
   its bytes/pointer and offer `--rollback-codex-skills`; never auto-recreate legacy on a downgrade.
2. The canonical target is `.agents/skills/**`, containing `project-sop`, `handoff`, `simplify`,
   `sop-flow`, and `sop-tier` plus their references. Every file is `owner=seed`: update only a
   pristine manifest-backed render; preserve modified/untracked canonical files even with
   `--force`. Use the maintained language artifacts where mapped; always source the simplify JSON
   from its single EN machine canonical and never translate it. Its manifest entry always stays
   `language="en"` / `translation_source="none(en)"` with no `translation_source_sha`.
3. For legacy `.codex/skills/project-sop/SKILL.md`, pristine means manifest owner/rendered sha
   match or exact membership in the built-in historical release hash table. Missing/corrupt
   manifest, foreign owner, missing entry, or unknown bytes is
   `legacy-skill-unknown-provenance`; preserve and require user adjudication. Modified content is
   `legacy-skill-migration-conflict` with explicit choices `move-preserving-content` or
   `keep-legacy`.
4. A pristine legacy source with absent canonical destination is migrated only after an exact
   hash-named backup is fsynced under `.ccsop/backups/`. Stage the canonical file, tombstone
   manifest entry (`migrated_from`, source/rendered sha, backup path/hash), and ccsop AGENTS block.
   Preflight every target, publish staged same-parent temp files, then remove the verified legacy
   source last; any failure restores the exact skill/manifest/pointer preimage and removes staged
   outputs. The successful pointer is
   `.agents/skills/project-sop/SKILL.md`.
5. Never overwrite an existing canonical destination. If legacy and canonical are both pristine
   but their bytes differ, report `legacy-canonical-divergence`; leave both and the pointer
   unchanged. A gate failure or any unresolved skill conflict similarly preserves the legacy
   pointer. A second successful run is a no-op.

`--rollback-codex-skills` performs no normal update. It succeeds only when the canonical
`project-sop` is still pristine, the legacy path is absent, and the manifest tombstone plus exact
backup sha all verify. In one transaction restore the legacy file, restore the legacy AGENTS
pointer, restore the pre-migration manifest entry, and remove only the verified migrated canonical
`project-sop`. Any later edit, missing/tampered backup, ambiguous provenance, or occupied legacy
path fails loud with zero writes. No ccsop downgrade auto-runs this rollback.

**Normative lifecycle matrix** (fixture IDs `C1`–`C15`; “unchanged” means byte-identical for the
skill trees, manifest, config, and AGENTS pointer unless the outcome column names a write):

| ID | input state | exact outcome |
|---|---|---|
| C1 | Claude-only flow, no legacy tree | `skipped (Codex not in use)`; no Codex probe; every byte unchanged |
| C2 | missing/unparseable/below-minimum host + legacy pointer | `host-gate-conflict`; legacy/manifest/pointer unchanged; canonical absent |
| C3 | supported host + pristine legacy + canonical absent | `legacy-backup+canonical-publish`: exact legacy backup; current five-skill canonical render + tombstone manifest; pointer becomes canonical; verified legacy source removed last |
| C4 | missing/corrupt manifest, missing entry, foreign owner, or unknown legacy bytes | `legacy-skill-unknown-provenance`; both trees and pointer unchanged |
| C5 | manifest-backed but locally modified legacy | `legacy-skill-migration-conflict`; explicit adjudication required; every byte unchanged |
| C6 | legacy + canonical both pristine but different | `legacy-canonical-divergence`; both trees, manifest, and pointer unchanged |
| C7 | canonical-only, manifest-backed pristine file + changed current render | `canonical-pristine-update`: that file and its manifest hashes update together; pointer stays canonical |
| C8 | canonical-only modified/untracked seed | `preserved (consumer-owned)` even with `--force`; file/entry/pointer unchanged |
| C9 | verified migration tombstone + pristine canonical + exact backup | `rolled-back`: restores exact legacy bytes/pre-migration entry/pointer and removes only the verified migrated canonical `project-sop`; the other four canonical skills remain |
| C10 | second run after C3/C7 | `up-to-date`; tree/manifest/pointer/backups byte-identical to first-run postimage |
| C11 | `ccsop_configure` absent/old during Step 2.D | `unfinished (scoped)`; config byte-identical; `/mcp` remedy; completed lifecycle/i18n work is retained |
| C12 | `/sop-lang` sees unresolved legacy-only state | `canonical-absent`; legacy/manifest/pointer stay byte-identical and untranslated |
| C13 | `/sop-lang` sees pristine canonical seeds | `canonical-language-update`: canonical prose re-materializes from maintained language and advances its hash |
| C14 | `/sop-lang` sees modified canonical seeds | `canonical-language-preserved`: modified seed bytes/entry are preserved with no language write |
| C15 | second `/sop-lang` after C13, with no modified seeds | `canonical-language-up-to-date`: no file or manifest bytes change |

The four AGENTS-pointer states are therefore pinned explicitly: C2 gate-fail = legacy; C4–C6
conflict-pending = preimage; C3/C7 success = canonical; C9 rollback = legacy.

## Step 2.D — Phase 1 config schema stamp

This command never constructs or edits TOML for schema migration. Discover `ccsop_configure` and
call `action=status`.

- Require `contract_version=1`.
- `observed_schema=null`: call `stamp-schema-v1` with the sha returned by status. Report its
  before/after sha, exact backup path, and changed key.
- `observed_schema=1`: record `up-to-date` with no write.
- any other schema/contract: fail loud for this entry, make zero config writes, and give compatible
  upgrade/remediation guidance.
- missing/old/unregistered tool: record a scoped informational conflict, make zero config writes,
  say to use `/mcp` and reconnect/restart, then continue updating skills, i18n, manifest, and other
  entries.

There is no direct-edit or shell fallback. `ccsop_configure` remains outside the automatic
permission baseline.

## Step 3 — `--force`

`--force` takes `accept-new` for all **`owner=ccsop`** conflicts (still backing up each `<file>.ccsop-bak`
first). Even with `--force`, **`overlay` paths and modified `seed` paths are never overwritten** (seed is
consumer-owned; only a pristine seed entry may be re-rendered).

## Step 4 — Finish

- Print a per-file summary: `updated` / `updated (N blocks preserved)` / `up-to-date` /
  `anchor-migrated` / `conflict (choice)` / `preserved (consumer-owned)` / `overlay-skipped` /
  `error (unresolvable maintained mapping)` / blocking warnings (malformed extension blocks).
- Include Codex host-gate/migration state and config-schema state. If the schema tool was
  unavailable, list the schema stamp under `unfinished (scoped)` with the `/mcp` remedy while
  reporting the rest of the update normally; do not claim the whole update failed.
- If any methodology rule changed, remind the user the change came from the plugin (single source);
  project-specific overrides should live in runbooks / overlay, not by editing owner=ccsop files.

## Step 5 — bridge codex-binary readiness (post-bump lifecycle)

This is the step `/sop-init` Step 6 has, restated here so the check is **reachable after a version
bump** — the original defect was that the only place it lived (`/sop-init`) aborts on an
already-adopted repo, so a bump silently left the bridge unable to resolve a codex binary
(design ccsop-bridge-deps-lifecycle §4.1 Part 3).

- The bundled `dist/server.js` is part of the plugin files and survives the bump, so the server
  itself still **starts** with no action. What a fresh plugin cache dir loses is any previously
  installed `@openai/codex` package (resolution link 2).
- Re-check that a codex binary is resolvable — `[codex] path` set, OR `@openai/codex` installed in
  the bridge dir, OR `codex` on `PATH`. If **none** resolve, apply the **same narrow plugin-root
  exception** as `/sop-init` Step 6: with the user's go-ahead, run
  `cd "${CLAUDE_PLUGIN_ROOT}/mcp/codex-review" && npm install` to provide the `@openai/codex`
  package; else print the three remedies and continue. Never fail `/sop-update` over it.
- If a codex binary is already resolvable (the common `provider=codex`-with-PATH case), this step is
  a no-op — report it and move on.

## Boundaries
- `owner=ccsop` files + **pristine** `owner=seed` entries (re-render only on **effective**
  LF-normalized sha match — stripped-of-valid-consumer-blocks for eligible Markdown, raw otherwise;
  see Step 2 preamble). A **modified/untracked** `owner=seed` entry, `records/current.md`
  (owner=overlay), and any user-converted overlay file are off-limits (not overwritten, even with `--force`).
- **`.claude/settings.json` is `owner=ccsop` but merge-only (Step 2.B)** — never whole-file
  re-rendered or `--force`-replaced; only `permissions.allow` is touched (migrate superseded ccsop
  review-tool names → the canonical three, preserve consumer additions). It is the one owner=ccsop
  entry that is consumer-extended by design.
- Work in the **target repo**, with ONE narrow exception, **stated identically in `/sop-init` Step 6**:
  the Step 5 codex-binary readiness step may run `npm install` inside
  `${CLAUDE_PLUGIN_ROOT}/mcp/codex-review` **solely to provide the `@openai/codex` package**
  (resolution link 2) when no codex binary is otherwise resolvable. The bundled `dist/` is never
  rebuilt here; the plugin's templates/source are never edited. This single optional `npm install` is
  the only permitted action outside the target repo.
- Never overwrite a locally-edited file without an explicit per-file choice or `--force` (+ backup).
- Resetting the breakpoint is a separate explicit action (`--reset-breakpoint`), not part of update.
