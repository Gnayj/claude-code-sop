---
description: Scaffold the ccsop delivery workflow into the current repo — interactive first-time setup. Materializes docs/ scaffolding + task templates + review config + permission baseline, and writes the .ccsop/manifest.json provenance file. Idempotent (skips existing; --force to overwrite).
---

# /sop-init — first-time scaffold wizard

You are scaffolding the **ccsop** delivery workflow into the user's repository. The plugin root is
`${CLAUDE_PLUGIN_ROOT}`; the target repo is `${CLAUDE_PROJECT_DIR}` (cwd). Work only in the target repo.

Argument `$ARGUMENTS` may contain flags: `--lang <en|zh|...>`, `--provider <codex|claude|manual>`,
`--force`. If absent, ask interactively (Step 2).

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

## Step 3 — Materialize the docs scaffold

Copy `${CLAUDE_PLUGIN_ROOT}/templates/docs-scaffold/` into the target `docs/`:
- `methodology/{project-delivery-sop,claude-code-sop-collaboration,workflow-overview,model-tier-strategy,index}.md`
- `plans/_template-{design,implement}.txt`; create empty `plans/active/` + `plans/completed/`
- `{design,runbooks,references}/index.md`; `docs/README.md`
- `records/current.md` — **only if absent**; fill `<PROJECT_NAME>` / `<YYYY-MM-DD>`; mark `owner=overlay`.

If language ≠ en, run each file through the placeholder-protection translation pipeline (see
`/sop-lang` Step "Pipeline") before writing — never translate machine-stable surfaces.

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

## Step 4 — Write `.ccsop/manifest.json` (provenance, per-file owner + double sha)

For every materialized file, append an entry:
```json
{ "template_id": "<relative template path>", "version": "<plugin version>",
  "language": "<lang>", "source_sha": "<sha256 of the canonical template>",
  "rendered_sha": "<sha256 of the file actually written>", "path": "<target path>",
  "owner": "ccsop" | "overlay" | "seed" }
```
- `owner=ccsop` (updatable by `/sop-update`, resettable by `--force`): all `methodology/*.md` **except
  `methodology/index.md`**, `plans/_template-*.txt`, `docs/README.md`, the review **config** (`config.toml`),
  the `settings.json` permission baseline.
- `owner=seed` (ccsop-seeded, consumer-owned — **path-based, overrides any prior `owner`**): the nav/index
  stubs `docs/{methodology,design,runbooks,references}/index.md` + the review-**prompt** templates
  `.codex-review/templates/*.tpl`. Written per the Step 3 seed policy (preserve+warn once consumer-populated);
  `/sop-update` & `/sop-lang` may re-render only a **pristine** entry (on-disk sha == `rendered_sha`), else preserve+warn.
- `owner=overlay` (bootstrap-once; `/sop-update` and `/sop-lang` NEVER touch): `records/current.md`.
- Compute sha with `sha256sum` over **LF-normalized** content (convert CRLF → LF before hashing) so
  `rendered_sha` is line-ending-insensitive — otherwise an `autocrlf` checkout re-introduces CRLF and
  `/sop-update` false-flags every file as locally-edited (F3). `rendered_sha` lets `/sop-update` detect
  local edits; `source_sha` detects upstream template changes.

## Step 5 — Review config + permission baseline

- Render `${CLAUDE_PLUGIN_ROOT}/templates/config.toml.tpl` → `.codex-review/config.toml`, filling
  `<PROJECT_ID>/<PROJECT_NAME>/<LANGUAGE>/<REVIEW_PROVIDER>/<TRANSLATION_PROVIDER>`.
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
