# Methodology index

The ccsop delivery methodology (ccsop canonical; `owner=ccsop`, updated via `/sop-update`). Read by
topic:

| Doc | What it covers |
|---|---|
| [`project-delivery-sop.md`](project-delivery-sop.md) | The delivery SOP: principles, doc structure, requirement→ship flow, feature checklist, test SOP (incremental log window / two-request / no global flush), commit & release, Bug SOP, Spike SOP, closeout self-audit. Single source of rules. |
| [`claude-code-sop-collaboration.md`](claude-code-sop-collaboration.md) | Collaboration protocol: the 3 modes (driver-led + reviewer gate / + auto review / reviewer-led fallback), roles, mandatory inputs, task-card convention, §4.5 design-pre-review triggers, §4.6 merge confirmation points, §4.7 worktree, §6 output contract, §9.A–§9.E review framework, §10.A subagent offload. |
| [`workflow-overview.md`](workflow-overview.md) | End-to-end flow diagram, per-stage artifacts, failure modes, rollback playbook. |
| [`model-tier-strategy.md`](model-tier-strategy.md) | Which model tier for which stage (strong for judgment, cheaper for mechanical, fresh-context for fan-out, independent for review) + the agent-in-cron boundary. |

Start a session with `/handoff` (or read `../records/current.md`); the `project-sop` skill is the
execution map pointing here.
