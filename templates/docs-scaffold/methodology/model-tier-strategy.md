# Model Tier Strategy

> ccsop canonical (English). Makes explicit the model-tiering that is otherwise scattered across
> the collaboration protocol (§10 / §10.A) and each agent's `model:` frontmatter. Principle:
> **match model power to the task's reasoning demand** — strong models for judgment and deep work,
> a cheaper tier for mechanical execution, fresh-context subagents for fan-out, and an independent
> (preferably heterogeneous) model for review.

## 1. Tiers by stage

| Stage / work | Tier | Rationale |
|---|---|---|
| Design / deep implement / fix judgment (the main session) | **Strongest model + max effort** (default) | Cross-step coherent reasoning, architecture, trade-offs — the part where quality compounds. |
| Mechanical execution: verify evidence collection, doc sync, deploy-per-runbook | **Cheaper "downgrade" tier subagent** (e.g. `sonnet`) | The contract is "do the steps, record verbatim, don't interpret"; interpretation stays in the main (strong) session. These are the `verify-runner` / `doc-sync` / `deploy-runner` agents. |
| Fan-out search / one-shot large-token "compress to a few lines" | **Fresh-context subagent** (`Explore` / `general-purpose`) | Returns conclusions, not file dumps; keeps the main window clean. Criteria: collaboration §10.A. |
| Review (design / code / fix) | **The model/instance `review.provider` selects** | Heterogeneity preferred (`codex` default): an independent model catches blind spots the driver's own model misses. `claude` provider loses that heterogeneity — see its caveat. |

## 2. Cost / rate downgrade

Default to the **strongest model + max effort** for implement / deep work. Lower the model or
effort **only** under cost or rate-limit pressure — and say so in the round's notes. Do not
silently downgrade the judgment tier; a weaker model on a judgment task is a false economy that
shows up as rework.

## 3. Mechanical-tier contract (why a cheaper tier is safe here)

The downgrade tier is safe precisely because the agents are constrained to *no judgment*:
- `verify-runner` collects evidence verbatim and does not decide PASS/FAIL.
- `doc-sync` writes confirmed facts into a named section and invents nothing.
- `deploy-runner` follows a runbook step-by-step and halts on any anomaly.

The strong main session sets up the task, provides expectations, and interprets the results. If a
task needs interpretation mid-stream, it does not belong on the mechanical tier.

## 4. Agents in cron — boundary

Reusing tiered agents in scheduled (cron) jobs has a boundary, and it is easy to over-generalize:

- **Do NOT put a monitoring / judgment agent in cron.** A monitor that can itself be unreliable
  (model hiccup, rate limit, bad parse) is self-contradictory as a watchdog. For unattended
  periodic checks, use a deterministic **shell sentinel** (a bash script with explicit thresholds +
  alerting), not an LLM agent.
- **Degradable batch work may run in cron** — work where a missed or degraded run is tolerable and
  self-correcting on the next run, and where no real-time judgment is required.
- **Do not over-generalize this to "never put an agent in cron".** The rule is about *monitoring /
  judgment* positions, not all scheduled work.

## 5. Landing

This document and each agent's `model:` (and `effort:`) frontmatter are mutually reinforcing: the
table here states the policy; the agent frontmatter (`agents/*.md`) is where it lands per agent.
When the policy changes, update both — or, better, keep the per-agent `model:` consistent with the
tier this document assigns to that agent's role.
