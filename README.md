# ccsop

> **Claude Code SOP framework** — an installable Claude Code plugin that packages a
> document-driven delivery workflow so any repository can adopt it in one step.

ccsop bundles seven building blocks refined on a real project into a single plugin:

1. a **delivery SOP** (contract-first, small steps, not-done-until-accepted, docs-as-breakpoint);
2. a **collaboration protocol** (driver + pluggable reviewer; design/code/fix review framework 9.A–9.E);
3. a **pluggable review MCP bridge** — `codex` | `claude` | `manual`;
4. **tiered subagents** (`verify-runner` / `doc-sync` / `deploy-runner`, mechanical = cheaper model);
5. **skills** (`/handoff` startup summary, `project-sop` execution map);
6. **doc scaffolding** (`docs/{records,methodology,plans,design,runbooks,references}` + task templates);
7. an explicit **model-tier strategy**.

Install the plugin, run `/sop-init`, pick a review provider, and start shipping under the workflow.

## Quickstart

```text
1. install ccsop (plugin marketplace / --plugin-dir)
2. /sop-init                 → scaffold docs/ + .codex-review/config.toml + .ccsop/manifest.json
                               (asks: project name, language, review provider, translation provider)
3. configure the provider    → codex: build the bridge + Codex login
                               claude: export ANTHROPIC_API_KEY
                               manual: nothing
4. write your first design   → docs/design/<module>/<id>-design.md (from _template-design.txt)
5. design review (if §4.5)   → codex_design_review → Go / Go-after-fixes
6. implement on a branch     → one sub-item; /simplify pre-screen; self-test
7. code review               → codex_code_review → Pass / Pass-after-fixes
8. user verify               → run the verify command, reply "test passed"
9. closeout                  → single-subject commit + handoff + code-home: ; ff-only merge per the 4 confirmation points
```

At session start, invoke `/handoff` for a ~150-line state summary instead of reading everything.

## Installing & first run

ccsop is a Claude Code plugin. A few setup notes make the first run smooth:

**Installing from a checkout (before it's in a marketplace).** Load ccsop from a **clean clone** —
a clone contains exactly the plugin's tracked files, so only ccsop's own commands/agents/skills/bridge
load:
```bash
git clone <repo-url> /path/to/ccsop
# build the review bridge once (its dist/ is produced on demand, not committed):
cd /path/to/ccsop/mcp/codex-review && npm install && npm run build
# launch Claude Code in your target repo with the plugin loaded:
cd /your/repo && claude --plugin-dir /path/to/ccsop
```
Plugin commands are **namespaced** under the plugin, e.g. `/ccsop:sop-init`.

**First-run order.** The review bridge reads the config that `/sop-init` writes, so run them in this order:
1. `/ccsop:sop-init` — scaffolds `docs/`, `.codex-review/config.toml`, and `.ccsop/manifest.json`,
   and offers to build the bridge. It **only adds files** — it skips anything you already have, makes
   no commit, and never overwrites without `--force` — so it's safe to adopt in an existing repo.
2. `/reload-plugins` (or restart) once after `/sop-init`, so the bridge picks up the new config.
   Until the config exists and the bridge is built, the `ccsop-review` server stays connected-but-idle
   and simply tells you to run `/sop-init` — no review work happens before setup is complete.

**Providers are needed only at review time.** Scaffolding (`/sop-init`) needs no provider. Configure
one when you're ready to review: `codex` (Codex login), `claude` (`ANTHROPIC_API_KEY` — Console
billing, separate from a Pro/Max plan), or `manual` (nothing). See the table below.

## Choosing a review provider

| Provider | What it is | Pros | Cons / caveat |
|---|---|---|---|
| `codex` (default) | review via the Codex SDK | **cross-model heterogeneity** — an independent model catches blind spots the driver's own model misses; this is the verified path | needs Node + `@openai/codex-sdk` + a Codex login |
| `claude` | review via the Anthropic SDK | no second vendor; runs anywhere with `ANTHROPIC_API_KEY` | **loses cross-model heterogeneity** — a fresh adversarial instance partially compensates but is not equivalent; documented, not equivalent to codex |
| `manual` | write a prompt, paste back a verdict | zero dependencies; human / external reviewer | two-phase (prepare → submit); you supply the verdict |

Switching providers is a one-line `review.provider` change in `.codex-review/config.toml`
(switching invalidates the prior session — no cross-provider thread reuse).

## Workflow at a glance

```
clarify → design ──(§4.5 trigger)──> design review ──Go──> implement → /simplify → self-test
                                                                                      │
        closeout ◀── "test passed" ◀── user verify ◀── code review (Pass) ◀──────────┘
            │
            └─ ff-only merge to main (4 confirmation points: push feature / merge / push main / delete remote)
```

The reviewer runs read-only (no network, no write); the driver executes the verdict mechanically
and only calls you on a circuit breaker or `No-Go`. Full flow, failure modes, and rollback playbook:
`docs/methodology/workflow-overview.md`.

## Commands & skills

- `/sop-init` — first-time scaffold wizard.
- `/sop-update` — pull ccsop-owned doc updates (conflict-safe; never touches your `records/current.md`).
- `/sop-lang <lang>` — re-materialize docs in another language (translate-once, machine-stable surfaces preserved).
- `/handoff` — structured project state for session start / task switch.
- `project-sop` — execution map pointing at the methodology docs.

## Layout

```
ccsop/
├─ .claude-plugin/plugin.json        plugin manifest (commands/agents/skills/mcpServers)
├─ commands/                          /sop-init · /sop-update · /sop-lang
├─ agents/                            verify-runner · doc-sync · deploy-runner (sonnet tier)
├─ skills/                            handoff · project-sop
├─ mcp/codex-review/                  the pluggable review bridge (ReviewProvider abstraction)
├─ templates/                         docs-scaffold/ (canonical EN) + config.toml.tpl + review-prompts/
└─ docs/design/ccsop-framework/       the framework's own design doc
```

## License

[MIT](LICENSE).
