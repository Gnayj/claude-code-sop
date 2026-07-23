---
description: Scaffold the ccsop delivery workflow into the current repo — interactive first-time setup. Materializes docs/ scaffolding + task templates + review config + permission baseline, and writes the .ccsop/manifest.json provenance file. Idempotent (skips existing; --force to overwrite).
---

# /sop-init — first-time scaffold wizard

You are scaffolding the **ccsop** delivery workflow into the user's repository. The plugin root is
`${CLAUDE_PLUGIN_ROOT}`; the target repo is `${CLAUDE_PROJECT_DIR}` (cwd). Work only in the target repo.

Argument `$ARGUMENTS` may contain flags: `--lang <en|zh|...>`, `--provider <codex|claude|manual>`,
`--force`. If absent, ask interactively (Step 2).

## Step 0 — Orphaned-root guard

If `${CLAUDE_PLUGIN_ROOT}/.orphaned_at` exists, **abort**: the plugin root is an orphaned cache
snapshot (plugin updated mid-session). Materializing from it scaffolds a stale version. Tell the
user to restart the session / reload plugins, then re-run. Never auto-resolve to a sibling dir.

## Step 1 — Detect environment

- Is this a git repo? If not, tell the user to `git init` first and stop (or proceed if they confirm).
- Does `docs/` already exist with ccsop scaffolding (`.ccsop/manifest.json` present)? If yes, this is
  not first-time — tell the user to use `/sop-update` instead, and stop unless `--force`.
- Provider dependency probe (report, don't auto-install):
  - `codex`: node present + `@openai/codex-sdk` installable + a Codex credential/login.
  - `claude`: `ANTHROPIC_API_KEY` set.
  - `manual`: none.

## Step 2 — Ask (skip any already given as a flag)

Ask, one decision at a time (chunked confirmation, SOP §4):
1. **project name** (for `[meta]` + the handoff title).
2. **language** for materialized docs (`en` canonical, or `zh`/other → translated once via the §4.3 pipeline; see `/sop-lang`).
3. **review.provider** (`codex` default | `claude` | `manual`) — note the codex heterogeneity advantage + the claude caveat.
4. **translation.provider** (only if language ≠ en): `claude` | `none` (BYO translated docs). If review.provider=manual, translation defaults to `none` (do NOT borrow the review model).
5. **collaboration flow** (`claude+claude` default | `claude+codex` | `codex+codex` | `codex+claude`) —
   who designs × who implements (collaboration.md §1.D); each stage's reviewer is the counterpart
   model, and the driving session lives in the design owner's CLI.
   - `claude+claude` → leave the `[collaboration]` owner keys **absent** (legacy mode: `review.provider`
     governs — this also keeps a `review.provider=claude` choice meaningful).
   - Any other flow → uncomment + fill `design_owner` / `implement_owner` in the config (Step 5) and
     materialize the **codex-side scaffold** (Step 3.A). Non-default flows pair naturally with
     `review.provider=codex|claude` (auto delivery); `manual` still forces manual delivery per stage.

## Step 3 — Materialize the docs scaffold

**Step 3.0 — maintained-language preflight (BEFORE any target write, when language ≠ en and a
maintained manifest exists)**: normalize the language alias to its canonical i18n dir first, then
resolve **every** in-scope target through
`${CLAUDE_PLUGIN_ROOT}/templates/i18n/<canonical-lang>/i18n-manifest.json`: each `template_id` must
match **exactly one** manifest entry (`source_path` equality) AND that entry's `target_rel` artifact
must exist on disk. Collect ALL failures (missing, ambiguous, artifact-absent); if any → **abort the
whole command with the failure list** — copy nothing, create nothing, back up nothing, update
nothing. Only a fully-resolved preflight may proceed to materialization.

Copy `${CLAUDE_PLUGIN_ROOT}/templates/docs-scaffold/` into the target `docs/`:
- `methodology/{project-delivery-sop,claude-code-sop-collaboration,workflow-overview,model-tier-strategy,index}.md`
- `plans/_template-{design,implement}.txt`; create empty `plans/active/` + `plans/completed/`
- `{design,runbooks,references}/index.md`; `docs/README.md`
- `records/current.md` — **only if absent**; fill `<PROJECT_NAME>` / `<YYYY-MM-DD>`; mark `owner=overlay`.

If language ≠ en, resolve the translation **source** (see `docs/design/ccsop-framework/i18n-docs-design.md`).
**First normalize the language alias to its canonical i18n dir** (`zh` / `zh_CN` / `zh-Hans` → **`zh-CN`**);
use the canonical form for the manifest lookup, the copied artifacts, and the recorded `language` / `translation_source`:
- **Maintained language** — `${CLAUDE_PLUGIN_ROOT}/templates/i18n/<canonical-lang>/i18n-manifest.json` exists:
  **copy the vetted translated artifacts** for every in-scope target (provenance `translation_source=maintained`).
  **All-or-nothing = the Step 3.0 preflight** (exactly-one mapping + artifact existence for every
  in-scope target, verified **before any write**; never silently mix with on-the-fly).
- **Unmaintained language** — no such manifest: run each file through the placeholder-protection translation
  pipeline (see `/sop-lang` Step "Pipeline") before writing — never translate machine-stable surfaces
  (`translation_source=on-the-fly`).
- Verify: `/sop-init --lang zh` resolves to `templates/i18n/zh-CN/` (maintained) and records `translation_source=maintained`, not fallback.

**Idempotency & write policy by file class** (classify each target before writing):
- **overlay** (`records/current.md`): create only if absent; never overwrite, even with `--force`.
- **seed** (ccsop-seeded but consumer-owned — see the seed set below): create if absent; if it already
  exists, **preserve + warn** by default (record `preserved (consumer-owned)`) — do NOT overwrite, even
  with `--force`, **unless** there is proof the on-disk file is the pristine rendered stub (its **LF-normalized**
  `sha256` — see Step 4 — equals the `rendered_sha` an existing manifest recorded for that path). On a first-time `/sop-init`
  there is no manifest baseline, so an already-existing seed file is treated as consumer content → preserve + warn.
- **ccsop** (everything else): if it already exists, **skip** (record `skipped`) unless `--force` (then
  back up `<file>.ccsop-bak` and overwrite).

Record `created` / `skipped` / `preserved (consumer-owned)` per file.

**Seed set (path-based — authoritative; overrides any manifest `owner` on these paths). Match on the
normalized target-repo path:** the nav/index stubs `docs/{methodology,design,runbooks,references}/index.md`
+ the review-prompt templates `.codex-review/templates/*.tpl` (the latter materialized in Step 5 — the same
seed policy applies there).

## Step 3.A — Codex-side scaffold (only when the chosen flow involves `codex`, or on request)

Materialize `${CLAUDE_PLUGIN_ROOT}/templates/codex-scaffold/` into the target repo so Codex-side
sessions (driving or implementer, §1.D) get the same execution map Claude-side ones have:
- `skills/project-sop/SKILL.md` → `.codex/skills/project-sop/SKILL.md` — **`owner=seed`** (same
  class + write policy as the nav stubs: create if absent; preserve+warn once consumer-owned;
  pristine-only re-render by `/sop-update` / `/sop-lang`).
- `AGENTS-snippet.md` is NOT copied as a file — **append its ccsop-managed block once** to the
  repo-root `AGENTS.md` (create the file if missing; idempotent — don't duplicate, don't touch the
  consumer's other content; same pattern as the Step 5 `.gitattributes` block). Codex CLI auto-reads
  `AGENTS.md`; the block points at the codex skill + `docs/methodology/`. The block is `owner=ccsop`.
- If language ≠ en, both go through the same Step 3 translation-source resolution
  (maintained mirror: `templates/i18n/<canonical-lang>/codex-scaffold/**`; else the placeholder
  pipeline).
- Remind the user: to run **auto review from the Codex side**, register the same review-bridge
  stdio server in Codex CLI's MCP config (`~/.codex/config.toml [mcp_servers]`, same `--config`
  argument); this wiring is user-verified — the bridge itself is CLI-neutral.

## Step 4 — Write `.ccsop/manifest.json` (provenance, per-file owner + double sha)

For every materialized file, append an entry:
```json
{ "template_id": "<relative template path>", "version": "<plugin version>",
  "language": "<canonical lang>", "source_sha": "<sha256 of the canonical template>",
  "rendered_sha": "<sha256 of the file actually written>", "path": "<target path>",
  "owner": "ccsop" | "overlay" | "seed",
  "translation_source": "none(en)" | "maintained" | "on-the-fly",
  "translation_source_sha": "<sha256 of the maintained i18n artifact — maintained entries ONLY>" }
```
- `translation_source_sha` (maintained entries only): LF-normalized sha of the maintained artifact
  (resolved via the language's `i18n-manifest.json` — the entry whose `source_path` equals this
  `template_id`) at render time. It lets `/sop-update` detect **translation-only revisions**
  (changed zh artifact, unchanged EN source). Omit for `none(en)` / `on-the-fly`.
- `translation_source`: `none(en)` for an EN materialization; `maintained` if copied from
  `templates/i18n/<canonical-lang>/` (Step 3); `on-the-fly` if produced by the §4.3 pipeline.
- `owner=ccsop` (updatable by `/sop-update`, resettable by `--force`): all `methodology/*.md` **except
  `methodology/index.md`**, `plans/_template-*.txt`, `docs/README.md`, the review **config** (`config.toml`),
  the `settings.json` permission baseline.
- `owner=seed` (ccsop-seeded, consumer-owned — **path-based, overrides any prior `owner`**): the nav/index
  stubs `docs/{methodology,design,runbooks,references}/index.md` + the review-**prompt** templates
  `.codex-review/templates/*.tpl` + the codex-side skill `.codex/skills/project-sop/SKILL.md` (Step 3.A).
  Written per the Step 3 seed policy (preserve+warn once consumer-populated);
  `/sop-update` & `/sop-lang` may re-render only a **pristine** entry (on-disk sha == `rendered_sha`), else preserve+warn.
- `owner=overlay` (bootstrap-once; `/sop-update` and `/sop-lang` NEVER touch): `records/current.md`.
- **Consumer extension blocks**: consumers may keep project-owned content inside ccsop-managed
  **Markdown** docs via `<!-- consumer:begin <slug> anchor="<token>" -->` … `<!-- consumer:end
  <slug> -->` blocks — `/sop-update`/`/sop-lang` preserve them across re-renders (grammar +
  algorithm: `commands/sop-update.md` Step 2.A). This is the sanctioned way to extend an
  owner=ccsop file without forking it.
- Compute sha with `sha256sum` over **LF-normalized** content (convert CRLF → LF before hashing) so
  `rendered_sha` is line-ending-insensitive — otherwise an `autocrlf` checkout re-introduces CRLF and
  `/sop-update` false-flags every file as locally-edited (F3). `rendered_sha` lets `/sop-update` detect
  local edits; `source_sha` detects upstream template changes.

## Step 5 — Review config + permission baseline

- Render `${CLAUDE_PLUGIN_ROOT}/templates/config.toml.tpl` → `.codex-review/config.toml`, filling
  `<PROJECT_ID>/<PROJECT_NAME>/<LANGUAGE>/<REVIEW_PROVIDER>/<TRANSLATION_PROVIDER>`. For a
  non-default collaboration flow (Step 2.5) also uncomment + fill the `[collaboration]`
  `design_owner` / `implement_owner` keys; for `claude+claude` leave them commented (absent =
  legacy semantics — see the tpl's precedence comment).
- Copy `${CLAUDE_PLUGIN_ROOT}/templates/review-prompts/*.tpl` → `.codex-review/templates/` **per the Step 3
  seed policy** (these are `owner=seed`: copy only if absent or a pristine prior render; preserve+warn if the
  consumer has customized them).
- Create `.codex-review/{sessions,archive,backlog}/` (with `.gitkeep`).
- Write/merge a `.claude/settings.json` permission baseline appropriate to the chosen provider
  (allow the bridge's read-only review commands; do not grant destructive prefixes).
- **Write/merge `.gitattributes` (F3 — line-ending stability)**: append an idempotent ccsop-managed block
  pinning `eol=lf` for the managed surface — `docs/** text=auto eol=lf`, `.codex-review/templates/** text=auto eol=lf`,
  `.ccsop/** text=auto eol=lf`. If the repo already has a `.gitattributes`, append the block once (don't
  duplicate, don't touch the consumer's other rules). For an **already-checked-out** repo, advise the user to run
  `git add --renormalize .` so existing CRLF files normalize to LF and stop false-conflicting in `/sop-update`.
- `config.toml`, the `settings.json` permission baseline, and the `.gitattributes` ccsop block are `owner=ccsop`;
  the `.codex-review/templates/*.tpl` review prompts are `owner=seed` (Step 4).

## Step 6 — MCP dependency install + finish

- The review bridge ships **prebuilt** under the plugin (`${CLAUDE_PLUGIN_ROOT}/mcp/codex-review`):
  its compiled `dist/` is committed in released installs, so a fresh install already has the server
  and needs only its runtime dependencies installed (no build) for the `ccsop-review` MCP to start:
  - With the user's go-ahead (it runs `npm`), run:
    `cd "${CLAUDE_PLUGIN_ROOT}/mcp/codex-review" && npm install`.
  - If node/npm is missing, offline, or the user declines, **print the command for them to run
    later** and continue — do not fail `/sop-init` over it.
  - The bridge is **degraded-safe**: until its deps are installed AND `.codex-review/config.toml`
    exists, the `ccsop-review` MCP server either won't load or returns a clear "run /sop-init /
    install the bridge deps" error rather than crashing. After this scaffold + `npm install`, run
    **`/reload-plugins`** (or restart) so the server loads with the new config.
  - For `provider=manual`, deps aren't strictly required to scaffold, but the bridge is still what
    runs the manual two-phase flow, so installing them is recommended.
- Print a per-file created/skipped summary + the manifest path + whether the bridge dependencies were installed.
- Final line: **"Next: `/reload-plugins` (to load the review bridge), then invoke `/handoff` or read `docs/records/current.md` and write your first design."**

## Boundaries
- Work in the **target repo**, with ONE exception: the Step 6 bridge **dependency install** may run
  `npm install` inside `${CLAUDE_PLUGIN_ROOT}/mcp/codex-review` (deps only — `dist/` already ships
  prebuilt). Never **edit** the plugin's own templates/source; this `npm install` is the only
  permitted action outside the target repo.
- Never overwrite an existing file without `--force` (and a backup).
- Never write secrets into tracked files.
