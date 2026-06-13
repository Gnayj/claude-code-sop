---
name: project-sop
description: Default workflow skill for a ccsop-adopting repository. Use for feature development, bug fixes, performance work, UI changes, deployment follow-up, regression, and any task that should follow the project's delivery SOP and handoff process.
metadata:
  short-description: Project SOP workflow map
---

# Project SOP Skill

The repository's in-repo workflow skill — an **execution map** that points at the rule source of
truth; it does **not** embed rule text (single source = `docs/methodology/`, to avoid drift).

Design principles:
1. `docs/methodology/project-delivery-sop.md` is the **single source** of SOP rules; this skill is
   a map + section pointers only.
2. Prioritize not regressing execution.
3. `docs/records/current.md` is the live state breakpoint.

## Collaboration mode

The default is **driver-led** (the driver does design / cards / implement / fix / closeout; the
reviewer does code review + design pre-review). Review is delivered manually
(`review.provider=manual`) or automatically via the review MCP bridge (`review.provider ∈
{codex, claude}`). A reviewer-led fallback also exists. Full definitions + switching:
`docs/methodology/claude-code-sop-collaboration.md §1`.

## Execution entry

1. **Startup order**:
   - prefer invoking `/handoff` for current state + active-task summary + locked decisions + next
     step (saves ~70% startup tokens);
   - or read `docs/records/current.md` directly when full context is needed;
   - then the topic doc for this module;
   - read `docs/records/archive/<period>.md` only to trace history;
   - **before implement / fix, read the full task card** (handoff is not ground truth).
2. **Task-card decision (design vs implement)**:
   - single-round (N=1): no implement card; fold the closeout summary into the design's implementation-record.
   - multi-round / relay (N≥2): one implement card per phase (from `docs/plans/_template-implement.txt`).
   - criteria: `claude-code-sop-collaboration.md §4.1`.
3. **`current.md` discipline**: keep only current state / recently accepted / current testing / real
   next step / key interfaces / key docs / resume template; move accepted-but-stale items to archive;
   no completed phases, long logs, or mis-set statuses in `current.md`.
4. **Default action**: when asked to "proceed per the SOP", follow the active collaboration mode's
   role split; do not take over an action assigned to the other role — report and let the user
   switch modes or hand off.

## Rule section map

This skill does **not** embed the SOP. Read the source by topic:

| Topic | SOP section |
|---|---|
| Goal / scope / principles | `project-delivery-sop.md §1 / §2` |
| Doc structure (records / plans / design / runbooks / references + `code-home:`) | §3 |
| Requirement → ship flow (chunked confirmation + exemptions) | §4 |
| Delegated authorization (destructive/high-risk need separate confirmation) | §4.1 |
| Feature checklist | §5 |
| `/simplify` pre-screen | §5.A |
| Test SOP (incremental log window / two-request / process-version consistency) | §6 |
| Backlog states / priorities | §7 |
| Doc update rules | §8 |
| Commit & release (incl. dep legitimacy) | §9 |
| Breakpoint recovery | §10 |
| Resume template | §11 |
| Bug SOP | §12 |
| Spike SOP | §13 |
| Closeout integrity self-audit | §14 |

**Collaboration protocol** (modes / roles / review 9.A–9.E / subagent offload §10.A):
`claude-code-sop-collaboration.md`. **End-to-end flow + failure modes + rollback**:
`workflow-overview.md`. **Model tiers**: `model-tier-strategy.md`.
