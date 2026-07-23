---
name: project-sop
description: Codex-side workflow skill for this repository (ccsop). Use when a Codex CLI session drives a task (design owner) or implements one (implement owner) under the project's delivery SOP — feature work, bug fixes, reviews, and any task that should follow the handoff process.
---

# Project SOP Skill (Codex side)

The Codex-side **execution map** for a ccsop-adopting repository. Like its Claude-side sibling
(`.claude` plugin skill), it points at the rule source of truth and does **not** embed rule text
(single source = `docs/methodology/`, to avoid drift).

Design principles:
1. `docs/methodology/project-delivery-sop.md` is the **single source** of SOP rules.
2. `docs/records/current.md` is the live state breakpoint — read it first, update it at handoffs.
3. Prioritize not regressing execution.

## Which role is this session? (flow matrix)

Read `.codex-review/config.toml` `[collaboration]` (rules: `claude-code-sop-collaboration.md §1.D`):

- `design_owner = "codex"` → **this CLI hosts the driving session.** Codex owns clarification,
  design, task cards, acceptance orchestration, and closeout. Design pre-review is performed by
  the **counterpart (claude)** — via the review bridge if registered in Codex CLI's MCP config,
  else manually forwarded by the user.
- `implement_owner = "codex"` → **this CLI hosts the implement segment** (§1.D rule 3): implement →
  self-test → code review (reviewer = counterpart claude) → fix loop → ready-to-test, then report
  the §6 structured results + update `current.md` and hand back to the driving CLI.
- Both keys absent → legacy single-driver mode; a Codex session here acts only per an explicit
  user instruction (typically as reviewer or reviewer-led fallback, §1 mode 3).
- Never switch flow / role on your own — the user or config selects it (§1).

## Execution entry

1. **Startup order**: read `docs/records/current.md` (state + active task + locked decisions);
   then the topic doc for this module; **before implement / fix, read the full task card**
   (`docs/plans/active/…`). Read archives only to trace history.
2. **Task cards**: split flows are a true relay — the implement card is the cross-CLI contract
   (§1.D rule 3 / §4.1). Do not widen its scope; on a blocker, pause and report rather than
   improvising around it.
3. **Structured output** (§6): at implement / fix / hand-back, report `docsRead / sopChecks /
   filesInScope / filesChanged / testsRun / validationEvidence / handoffUpdated / commit /
   mode / flow / designReview / knownRisks / nextStep`.
4. **Closeout discipline**: closeout belongs to the **design owner's session**. When that is this
   session, follow SOP §4.2 closeout (docs sync → single-subject commit → card archive →
   `code-home:` line). When it is not, stop at ready-to-test + hand back.

## Review bridge (auto review from the Codex side)

The repo's review bridge is CLI-neutral (stdio MCP). To use auto review here, register the same
server + `--config .codex-review/config.toml` in Codex CLI's MCP config (`~/.codex/config.toml
[mcp_servers]`). The bridge derives each stage's reviewer from `[collaboration]` (§1.D — the
counterpart model; fix review inherits the session's reviewer). Without the bridge registered,
review delivery is manual: the user forwards prompts/verdicts.

## Rule section map

Rules live in the SOP docs — read by topic, do not duplicate here:

| Topic | Source |
|---|---|
| Requirement → ship flow / checklists / test SOP / closeout | `docs/methodology/project-delivery-sop.md` |
| Modes / flow matrix / roles / review framework 9.A–9.E / output contract | `docs/methodology/claude-code-sop-collaboration.md` |
| End-to-end flow + failure modes + rollback | `docs/methodology/workflow-overview.md` |
| Model tiers | `docs/methodology/model-tier-strategy.md` |
