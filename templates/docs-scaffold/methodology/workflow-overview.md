# Workflow Overview — driver-led + reviewer

> End-to-end overview of the `driver-led + auto review` flow, integrating the SOP, collaboration
> protocol, and review-bridge design. **No new rules** — integration + quick reference only.
> "Driver" = implementing agent; "reviewer" = whatever `review.provider` selects.

## 1. Collaboration modes (quick reference)

Two live modes (see `claude-code-sop-collaboration.md §1`):

| Mode | Review communication | implement / closeout | When |
|---|---|---|---|
| **`driver-led + auto review`** (default when the bridge is wired) | MCP auto-invokes the reviewer (`codex_design_review` / `codex_code_review` / `codex_fix_review`) | driver implements + closes out | day-to-day iteration |
| `driver-led + reviewer gate` | user **manually** forwards diff / verdict (or `review.provider=manual`) | driver implements + closes out | bridge down, or manual control wanted |
| `reviewer-led closed loop` (fallback, dormant) | user/automation forwarded | reviewer owns design + acceptance + closeout; driver implements | reviewer-owned design/acceptance wanted (see collaboration §1 mode 3 / §8.1) |

## 2. End-to-end flow

```
(1) Requirement clarification
    Driver-led; SOP §4 "chunked confirmation"; user sets business goal + acceptance signal
        ↓
(2) Design
    Driver writes design.md; lock decisions if the user answered Q1-QN
    Output: docs/methodology/<id>-design.md  or  docs/design/<module>/...
        ↓
   §4.5 trigger hit? ── no ──→ skip design review
        │ yes
        ↓
(3) codex_design_review (auto)   verdict ∈ {Go, Go-after-fixes, Rereview-after-fixes, No-Go}
        Go / Go-after-fixes      → mechanical fix → implement
        Rereview-after-fixes     → fix → re-review
        No-Go                    → stop, report user, redesign
        ↓
(4) Implement   on a feature branch off main (branch = design-id or custom)
    N=1 single round: no implement card; N≥2: one card per phase
    each commit single-subject
        ↓
(5) /simplify pre-test pre-screen  (SOP §5.A: code-suffix allowlist + ≥30 add+del lines)
    TRIGGER → run /simplify → self-fix → re-run until clean
    EXEMPT / unavailable → skip + record reason (non-blocking)
        ↓
(6) Self-test (driver)   build / test / incremental log window / verify scripts (SOP §6.4)
        ↓
(7) codex_code_review (auto)   verdict ∈ {Pass, Pass-after-fixes, Rereview-after-fixes, No-Go}
        Pass / Pass-after-fixes  → mechanical fix → "ready to test"
        Rereview-after-fixes     → fix → re-review (breaker after the round cap)
        No-Go                    → stop, report user
        ↓
(8) User verify   user runs verify commands, replies "test passed" / "failed: X"
        "test passed" → Closeout      "failed" → still implement; fix → re-test
        ↓
(9) Closeout (driver, single commit)   handoff closeout + task-card archive + code-home: line
    N=1: append closeout summary to design.md implementation-record section
    N≥2: archive each phase's implement card to docs/plans/completed/<module>/
        ↓
(10) Merge to main (collaboration §4.6, 4 confirmation points)
    push feature → ff-only merge main → push main → delete remote feature; each confirmed separately
```

## 3. Per-stage artifacts

| Stage | Artifact | Path |
|---|---|---|
| (2) Design | `<design-id>-design.md` | `docs/methodology/` (methodology) / `docs/design/<module>/` (feature) |
| (3) design review | review envelope | bridge state; design.md top records the review chain (Round N verdict + finding ids) |
| (4) Implement | feature branch off main | `<design-id>` or custom |
| (4) Implement card | one per phase in multi-round | `docs/plans/active/<design-id>-<phase>-implement.txt` (single-round: none) |
| (5) /simplify | self-test evidence | implement commit / verify evidence records TRIGGER/EXEMPT + reason |
| (6) Self-test | verify scripts / interface results | `scripts/verify_*.sh` (runtime features) + incremental logs |
| (7) code review | review envelope | bridge state; closeout commit references the review chain |
| (8) User verify | "test passed" / "failed: X" | user reply |
| (9) Closeout | closeout commit + archive | N=1: design implementation-record; N≥2: implement card + `completed/<module>/` |
| (9) `code-home:` | single key:value line | design doc end, or implement card end |
| (10) Merge | ff-only merge + main push | `code-home:` backfilled with sha |

## 4. Single design.md vs design+implement cards

- **Single design.md (default):** one `<id>-design.md` is both the design and the round contract;
  implement cards only for multi-round / multi-person relay. Suits auto review (no card needed as a relay).
- **Two cards (legacy):** separate design + implement cards; suits a reviewer-led split flow.

Decision matrix (same as `collaboration §4.1`):

| design scope phases | implement card |
|---|---|
| N=1 single round | none; closeout summary → design implementation-record |
| N≥2 independent-closeout phases | one per phase (from `_template-implement.txt`) |
| N=1 paused mid-round / relay | one card, created at the phase switch |

## 5. /handoff and /simplify in the flow

| skill | stage | trigger | output / behavior |
|---|---|---|---|
| `/handoff` | before (1) / session start / switching active task | user says "proceed per SOP / what's the state / continue <task>" | ~150-line structured handoff (mode + active task + scope + non-goals + acceptance + review state + locked decisions + collaboration boundary + next step) |
| `/simplify` (built-in) | (5) after implement, before self-test | changed suffix in the code allowlist AND ≥30 add+del lines | reports issues or none; driver self-fixes; does not replace the reviewer |

## 6. Failure modes

| Symptom | Path | Source |
|---|---|---|
| `codex_code_review = No-Go` | stop; report user; don't auto-restart the loop | collaboration §3 |
| `codex_code_review` repeatedly `Rereview-after-fixes` past the cap | breaker fires; stop, report | bridge design (breakers) |
| `codex_design_review = No-Go` | redesign; don't enter implement | collaboration §4.5 |
| `/simplify` false positive | inline note + evidence "non-issue: <reason>"; continue to the reviewer (which can still reject) | SOP §5.A |
| user verify "failed: X" | not closed out; fix → re-self-test → re-test; no closeout commit | SOP §6.3 |
| build / test fails | normal in-implement fix; don't report "ready to test" | SOP §5 |
| bridge / provider unavailable | degrade to manual forwarding; record reason; don't auto-restart auto channel | collaboration §3 |
| §4.5 trigger unclear | default to pre-review | collaboration §4.5 |
| ff-only merge fails (diverged) | pause; don't rebase on your own; report user | collaboration §4.6 |
| session blocked (fix loop stuck / awaiting user) | start a git worktree, run another session for other work | collaboration §4.7 |
| `/handoff` missed key info | re-Read the full task card / design doc after invoking | collaboration §4 |
| `/simplify` unavailable | skip + record reason; non-blocking | SOP §5.A |
| fix loop won't converge (same Critical recurs / Critical total flat 2 rounds / regression ping-pong) | mark stall; stop; report divergence + ≥2 options; escalate at the soft cap | collaboration §9.E |
| trial/diagnostic patch left in main code | probes go in disposable scripts + three-state verdict; temp main-code changes registered, cleaned or consolidated at closeout | SOP §13 + §14 |

## 7. Rollback playbook (by point reached)

| State | Rollback | Risk |
|---|---|---|
| local working tree, uncommitted | `git checkout -- <file>` / re-edit | none — reversible |
| committed, not pushed | `git reset --hard HEAD~N` | **destructive — separate user confirmation** (SOP §4.1) |
| pushed feature branch (unmerged) | `git revert <sha>` + push, or delete remote branch (user-authorized) | non-rewriting |
| ff-only merged main, main not pushed | `git reset --hard <pre-merge-sha>` | **destructive — separate user confirmation** |
| pushed main | `git revert <sha>` + push a new commit; **no force-push** | force-push is forbidden |
| deployed to production | deploy the old binary + `git revert` + new commit (see `docs/runbooks/`); **report user first** | high-risk; not auto-allowed |
| post-closeout design error (not a bug) | revert the closeout commit + pull design back to draft + fix + re-run design review | rare; the reviewer should have caught it |

## 8. References

- Modes + roles + mandatory inputs: `claude-code-sop-collaboration.md §1 / §2 / §4`
- Task-card convention: `claude-code-sop-collaboration.md §4.1`
- §4.5 design pre-review triggers / §4.6 merge confirmation points / §4.7 worktree: `claude-code-sop-collaboration.md`
- Review framework + convergence + subagent offload: `claude-code-sop-collaboration.md §9 / §10.A`
- Feature checklist + test SOP + Bug SOP + Spike + closeout self-audit + dep legitimacy: `project-delivery-sop.md §5/§6/§12/§13/§14/§9`
- Model tiers: `model-tier-strategy.md`
- Review bridge (envelope schema / verdict_factors): the ccsop review MCP (`mcp/codex-review`)
