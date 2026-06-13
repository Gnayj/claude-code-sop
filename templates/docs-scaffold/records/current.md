# Session Handoff (Current) — <PROJECT_NAME>

Last updated: <YYYY-MM-DD>.

> This file is the live breakpoint (owner=overlay). `/sop-init` writes this skeleton only if the
> file is absent; `/sop-update` and `/sop-lang` NEVER touch it. You maintain it. `/handoff` reads it.

## 1. Current state (at a glance)

1. <one-line project summary>
2. main = canonical branch; new work branches off main and ff-only merges back.
3. **Next step**: <the one concrete next action>.
4. **Collaboration mode** = <`driver-led + reviewer gate` | `driver-led + auto review` | `reviewer-led closed loop`> (see `docs/methodology/claude-code-sop-collaboration.md §1`).

## 2. Archived

(none yet; archive to `docs/records/archive/<period>.md` by quarter/phase.)

## 3. Pause points

> One `### 3.0.X <task>` sub-section per active task. Skip the closeout index (archived tasks).
> Each active sub-section should carry: the artifact path (`task card: docs/plans/active/<...>.txt`
> or `design doc: docs/design/<...>/...md`), design-pre-review state, and closeout state.

### 3.0.A <active task name> (<state>)

- task card: `<path>` (or `design doc: <path>` for N=1 single-round)
- design pre-review: <verdict / N/A>
- next step: <...>

## 4. Collaboration boundary / locked decisions / key files

- Locked decisions Q1-QN: <one line each, or "none yet">
- Collaboration mode: <as in §1 bullet 4>; feature → main via the §4.6 4 confirmation points.
- Key files: <paths>
