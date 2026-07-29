---
name: handoff
description: Generate a fresh structured ccsop project handoff at session start, task switch, resume, or when the user asks for current state.
---

# Handoff

Always re-read sources; never cache a handoff.

1. Read `docs/records/current.md` and identify its current-state and active-task sections by
   headings, not fixed numbers. Ignore archive/closeout indexes.
2. Extract active `task card:` / `任务卡:` paths and `design doc:` / `design 文档:` paths.
3. Read only the goal/scope, non-goals, acceptance, review state, locked decisions,
   collaboration boundary, next step, and `code-home:` fields from each active artifact.
4. Emit collaboration mode, active tasks, those fields, warnings for missing artifacts, and the
   next step in at most about 150 lines.
5. State explicitly that implement/fix still requires a complete read of the active task card.

Do not read archives, closed cards, or unrelated topic docs unless the user asks. Never infer
missing content.
