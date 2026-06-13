---
name: handoff
description: At session start or when switching the active task, emit a structured project handoff (collaboration mode / active tasks / scope / non-goals / acceptance / review state / locked decisions / collaboration boundary / next step), saving startup tokens (full-read 17-25k → ≤6000). Use when the user asks to resume work, asks "what's the state / what are we doing", switches to a different active task, or needs project context at session start.
metadata:
  short-description: Project state handoff for session start / task switch
---

# /handoff Skill

Emit a structured handoff of the current project for fast alignment at session start or when
switching the active task.

## Design principles

1. **Always read from the source of truth**: every invocation re-reads `docs/records/current.md`
   + the active task artifacts; this skill caches no state summary, so there is no staleness risk.
2. **Cover the minimal quality gate**: the output must include each active task's goal / scope /
   non-goals / acceptance / review state / collaboration boundary / locked decisions / next step,
   to prevent scope drift in later implement / fix.
3. **Not a substitute for the source**: handoff is a startup summary; **before implement / fix you
   must still read the full task card** (this skill is not ground truth).
4. **Do not read** archive / topic design docs / full SOP / closed-out task cards (unless the user explicitly asks).

## Steps (do not skip any)

### Step 1 — Read `docs/records/current.md`

This skill reads `current.md`'s **actual section structure** (do not assume fixed section
numbers). Extract:
- the **current-state** section (the top "current state / at a glance" summary).
- under the **pause-points / active-tasks** section, every active task sub-section, but **skip the
  closeout/archive index** (those are archived tasks, not active).
- each active task sub-section typically carries: the artifact path, design-pre-review state /
  verdict, and closeout state.

### Step 2 — Extract active task-card / design-doc paths

From the active sub-sections, pull every active artifact path by **prefix keyword** (language-tolerant), covering two kinds:

| Prefix keyword | Path | Case |
|---|---|---|
| `task card:` / `任务卡:` | `docs/plans/active/<...>.txt` | multi-round / relay (N≥2 implement card) |
| `design doc:` / `design 文档:` | `docs/methodology/<...>-design.md` or `docs/design/<...>/*.md` | **N=1 single-round implement** (no implement card; the design doc is the round contract — see `claude-code-sop-collaboration.md §4.1`) |

Identify both kinds; **do not miss the N=1 design-doc artifact**. If the user passed a `<task-id>`
argument (e.g. `/handoff auth-refactor`), keep only artifacts whose path contains that id; else keep all.

### Step 3 — Extract sections from each card by heading regex

For each active artifact, **extract locally with grep + Read offset/limit** (do not full-read):

| Field | Heading regex (CJK/EN tolerant) | Use |
|---|---|---|
| goal / scope | `^#+ .*(目标\|[Ss]cope\|[Gg]oal)` | what the task does |
| non-goals / boundary | `^#+ .*(非目标\|[Nn]on-?[Gg]oal)` | prevent scope drift |
| acceptance | `^#+ .*(验收\|[Vv]erify\|[Aa]cceptance)` | pass criteria + verify commands |
| review state | `^#+ .*([Dd]esign pre-review\|[Rr]eview)` | current review progress |
| locked decisions | `^#+ .*(设计决策\|锁定决策\|[Ll]ocked\|[Oo]pen [Qq]uestion)` | Q1-QN locked answers |
| collaboration boundary | `^#+ .*(协作边界\|[Cc]ollaboration [Bb]oundary)` | this card's collaboration constraints |
| code-home | the `code-home:` line in the file | current merge/deploy state |

(Use heading regex rather than fixed section numbers — design vs implement cards number these
sections differently on purpose.)

### Step 4 — Emit the structured handoff (~150 lines / ≤6000 tokens)

```
# Handoff (generated <YYYY-MM-DD>)

## Collaboration mode
<one line from current.md current-state>

## Active tasks (N)

### Task 1: <name> [<state: design draft / implement / testing / blocked>]
- artifact: `<path>`
- Goal / Scope: <bullets>
- Non-goals / boundary: <bullets>
- Acceptance: <bullets; list scripts/verify_*.sh if any>
- Review state: design pre-review <verdict / N/A> · code review <verdict / N/A>
- Locked decisions (Q1-QN): <one line each>
- Collaboration boundary: <2-4 key constraints>
- code-home: <line from card / "n/a">

## Next step
<from current.md current-state next-step>

---
For deeper context, read current.md / the full task card / the topic design doc on demand.
Before implement / fix you MUST read the full task card (handoff is not ground truth).
```

### Step 5 — Fallback

- `current.md` missing / unreadable → print "current.md missing or unreadable; cannot generate handoff; confirm repo state" and stop.
- active sub-sections empty (only a closeout index) → print "no active tasks; see current-state summary + next step" + the current-state summary.
- a card field's heading regex doesn't match → output "(not provided; see full file)" for that field; don't block the others.
- an active sub-section has a `design doc:` prefix but the path won't resolve → mark "(design-doc path anomaly; see current.md sub-section verbatim)"; don't block the task's other fields.

### Step 6 — Self-check (built in)

Verify that every active sub-section in `current.md`'s pause-points section maps to one output Task
node (regardless of `task card:` vs `design doc:` prefix). If an active sub-section yielded no
artifact path → output "WARN: <sub-section> produced no artifact path; check prefix convention";
don't block the other output.

## Boundaries

- **Never** read archive / topic design docs / full SOP / closed-out cards (unless the user explicitly asks).
- **Never** invent / infer / fabricate card content; only quote the source.
- **Never** substitute for the full task-card read in implement / fix (tell the user this explicitly).

## Usage

- "continue" / "what's the state" / "proceed per SOP" → invoke `/handoff`.
- "switch to <task-id>" → `/handoff <task-id>` (only that task's handoff).
- "I'm going to implement <task-id>" → `/handoff <task-id>`, then **additionally read the full task card** before implementing.
