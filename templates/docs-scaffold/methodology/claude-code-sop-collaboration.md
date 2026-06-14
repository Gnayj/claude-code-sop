# Collaboration Protocol (driver + reviewer)

> ccsop canonical (English). Pairs with `project-delivery-sop.md` and `workflow-overview.md`.
> The "reviewer" is whatever `review.provider` selects (`codex` | `claude` | `manual`); the
> "driver" is the implementing agent (e.g. Claude Code). This protocol genericizes a
> battle-tested workflow; it keeps the rules and only swaps project anchors for `${...}`.

## 1. Modes

Three collaboration modes; the first two are **driver-led** (the default shape) and differ only in
how review is delivered, the third is a **reviewer-led** fallback:

1. **`driver-led + reviewer gate` (default).** The driver does clarification, design, task
   cards, implement, fix, closeout. The reviewer does **code review** (and design pre-review
   when §4.5 triggers). When `review.provider = manual`, review communication is forwarded by
   the user (the driver writes a prompt, a human/external reviewer returns a verdict).
2. **`driver-led + auto review`.** When `review.provider ∈ {codex, claude}` and the review MCP
   bridge is wired, the driver invokes `codex_design_review` / `codex_code_review` /
   `codex_fix_review` automatically at the §4.5 / implement / fix nodes — no manual forwarding.
   The driver then executes the verdict mechanically (see §3 verdict matrix). The user is only
   interrupted on a circuit-breaker or `No-Go`.
3. **`reviewer-led closed loop` (fallback, dormant by default).** Roles invert: the reviewer owns
   design, task cards, review, acceptance, and may perform closeout; the driver implements code +
   test scripts and returns structured results (§6). Communication is forwarded by the user or a
   project-specific automation (the automation itself is **not** part of ccsop — provide your own
   if you want this fully automated). Use this when you want the stronger/independent model to own
   design and acceptance and the driver to be a pure implementer. See §8.1 for its loop.

All modes obey `project-delivery-sop.md` and must close the full loop
(design → implement → test → review → fix → closeout); doing only a middle segment is not "done".
**Mode is selected explicitly** — by the user (an explicit switch instruction) or project config;
neither driver nor reviewer switches modes on its own. Switching to auto review requires the bridge
to pass its self-test (`verify-mcp`); on bridge/provider failure auto review degrades to mode 1 and
does not auto-recover.

## 1.A Autonomy dial (orthogonal to the modes)

A third axis on the **driver-led** modes (it does not change roles, so it is not a 4th mode):
- **`gated` (default)** — the user confirms the design (§4 chunked confirmation), gives "test passed"
  (`project-delivery-sop.md §6.2`), and confirms each §4.6 merge point.
- **`full-auto`** — the driver auto-advances the **routine** gates: design sign-off via the self-checked §4
  contract + the §3 auto-review loop; acceptance via self-verification **where legitimate** (§1.C); local
  closeout + a local `git merge --ff-only` to main (§4.2/§4.6). The run ends with a **run report** (§6.A). The
  driver **breaks the loop and hands control to the user only when the escalation predicate (§1.B) fires.**

Set it in `.codex-review/config.toml` `[collaboration] autonomy = "gated" | "full-auto"` (operational key; the
review bridge ignores it; a missing/invalid value is **fail-closed to `gated`**). An explicit user instruction
("full-auto" / "一杆推到底" / "gated this one") overrides per session. full-auto **never** relaxes the §1.B never-auto classes.

## 1.B Escalation predicate (full-auto stops and hands to the user iff)

full-auto runs unattended **except** when any of these holds — then it stops, reports, and recommends ≥1 option:
1. **Always-confirm (`project-delivery-sop.md §4.1`)** — destructive / irreversible op, production config or
   service change, irreversible DDL/DML, deploy / restart / wipe. (never auto)
2. **Exfil-class** — sending private content to an external service (e.g. a private→public push). (never auto)
3. **Remote externalization (§4.6)** — pushing to a remote, deleting a remote branch, publishing / releasing
   (local closeout + local ff-only merge to main is auto; **all remote** actions escalate). (never auto)
4. **Taste / domain / acceptance judgment only the user can make** — subjective quality (prose / translation /
   UX), real-environment or production acceptance, business-priority calls, "is this acceptable" gates.
5. **Unresolvable ambiguity** — scope/requirement genuinely under-determined and not resolvable from context,
   the codebase, or the reviewer. (A choice resolvable by a sensible default or by the reviewer is **not** an
   escalation — decide, record, proceed.)
6. **Stall (§9.E)** — the fix loop is not converging (same Critical 2 rounds / Critical total flat 2 rounds /
   regression ping-pong) → escalate with ≥2 options.
7. **Review `No-Go` / breaker** — design or code review `No-Go`, or a circuit breaker tripped.
8. **Technical fork → reviewer first** — a *technical* design fork with no clear default goes to
   `codex_design_review` (not the user); only a *preference/business* fork goes to the user.
9. **Execution blocker** — missing credential/key, platform permission denial, sandbox / network / dependency
   constraint, a required tool unavailable, or a **required verification that cannot actually be run**. Escalate
   with the failed command + evidence; **never self-verify a check that did not run.**

## 1.C Self-verification boundary + early sample-checkpoint

- **Self-verify MAY substitute** for the user's "test passed" only when the acceptance is **machine-checkable**:
  build/compile, automated tests, grep/schema/drift-gate invariants, spec-conformance against the design.
- **Self-verify MAY NOT substitute** (→ escalate per §1.B.4/§1.B.9) for subjective quality, real-environment /
  production acceptance, or anything needing external observation or domain/business judgment.
- **Early sample-checkpoint (anti "efficiently wrong"):** for **taste/style-heavy** or **large-batch**
  deliverables, full-auto produces a small **representative sample** and checkpoints it with the user **before**
  mass production — don't generate the whole batch on an unconfirmed style/contract.

## 2. Roles

1. **Driver** — clarification + brainstorming (SOP §4 chunked-confirmation cadence); design,
   task cards, acceptance criteria; implementation, test scripts, verification commands; runs
   `/simplify` pre-screen (SOP §5.A); runs self-test and reports structured results (§6 fields);
   applies review fixes; performs closeout after the user's "test passed" (single-subject commit
   + handoff closeout + task-card archive + `code-home:` line). On a blocker (rate limit /
   permission / environment / unclear contract) it pauses and reports — it does not silently widen scope.
2. **Reviewer** — looks at the real repo diff / task card / test evidence / handoff state and runs
   §9 (9.A/9.B/9.C/9.D); does design pre-review when asked or when §4.5 triggers. Does not
   clarify requirements, implement, write tests, or close out. In auto mode it runs read-only,
   approval=never, no network, no web-search, and emits the strict envelope schema + 9
   `verdict_factors` + predicate (see the bridge design).
3. **User** — runs verify scripts; gives the "test passed" signal; explicitly confirms all
   destructive / high-impact actions (merge to main, push, branch deletion); in manual mode,
   forwards driver↔reviewer communication.

The roles above describe the driver-led modes (§1 modes 1–2). In the **reviewer-led fallback**
(§1 mode 3 / §8.1) they invert: the reviewer owns design / task cards / acceptance / closeout, and
the driver is a pure implementer (code + test scripts only).

Under the **autonomy dial** (§1.A): in `full-auto` the User's "confirm destructive / high-impact actions" duty
(§1.B.1–3) is **unchanged**; what full-auto auto-advances is only the *routine* design sign-off / "test passed"
/ local-merge gates (per §1.B / §1.C).

## 3. Auto-review verdict matrix

In auto mode the driver executes the envelope verdict mechanically — it does not re-interpret
prose (if prose and verdict disagree, **the verdict wins**):

- `Go` / `Pass` → proceed to the next stage.
- `Go-after-fixes` / `Pass-after-fixes` → apply the mechanical fixes; do **not** re-run
  design/code review; proceed.
- `Rereview-after-fixes` → after fixing, return to the corresponding review stage (run `codex_fix_review`).
- `No-Go` → stop and report to the user.

The driver auto-loops to "ready-to-test"; only a circuit breaker (max rounds / scope drift /
context exhausted / reviewer unavailable / parser unavailable) or `No-Go` calls the user back.
On bridge/provider failure the driver **degrades to manual forwarding** and says so explicitly;
it never auto-recovers — the user must re-enable auto mode.

## 4. Mandatory inputs

Before acting, the driver reads into context:
1. `docs/methodology/project-delivery-sop.md`
2. `docs/records/current.md`
3. the topic doc for this module
4. this round's task card

**At session start / when switching the active task, prefer invoking `/handoff`** instead of
reading all four in full (saves ~70% startup tokens). `/handoff` extracts the minimal quality-gate
sections (goal / non-goals / acceptance / review state / locked decisions / collaboration
boundary / next step) from `current.md` + the active task card. **Before entering implement / fix
you still MUST read the full task card** (handoff is not ground truth); read SOP full text and the
module design doc by-section on demand during implement, not pre-emptively.

## 4.1 Task-card convention (design vs implement cards)

Decide whether this round needs a new implement task card by whether the design's scope splits
into **multiple independent implement phases** (each with its own closeout + `code-home:`):

| Case | Handling |
|---|---|
| **N=1** single-round implement | **No implement card.** Fold the closeout summary into the design's implementation-record section. The design doc is the round contract. |
| **N≥2** multi-phase (each phase independent closeout / different ship cadence) | **One implement card per phase** `<design-id>-<phase>-implement.txt` from `docs/plans/_template-implement.txt`; each archived to `docs/plans/completed/<module>/`. |
| **N=1 but paused / handed off mid-round** | Create the implement card after the first phase closes. |

Rationale: in single-round cases an implement card is redundant (everything folds into the design
doc); in multi-round cases the design doc is the persistent cross-round doc and per-phase cards
keep it from bloating and let `code-home:` be maintained per phase.

## 4.2 Phased execution

- **`plan`** — contract confirmation, implementation plan, risk + acceptance only. No code edits,
  no commit. Declare `scope / nonGoals / filesInScope / nextStep`. The design owner raises
  "business goal + acceptance signal" first (SOP §4 chunked confirmation), with the same exemptions.
- **`implement`** — implement one acceptable sub-item; run minimal self-test; update handoff + topic
  doc. No `git add/commit/push` outside closeout. Output `testsRun / validationEvidence / handoffUpdated`.
- **`fix`** — fix only the reviewer's findings; do not widen scope. The `summary` focuses on "what was fixed".
- **`closeout`** — only after the user replies "test passed"; performed by the driver. Steps (in order):
  1. update `docs/records/current.md` (move task from in-progress to done; add a status card if needed);
  2. update the topic doc (design / runbook / handoff);
  3. append the `code-home:` line to the task card (SOP §3.4 values; `branch=<branch>@<sha>(unmerged)` if not yet merged);
  4. move the card from `docs/plans/active/` to `docs/plans/completed/<module>/`;
  5. single-subject conventional commit (`feat(<module>): …` / `fix(…)` / `docs(…)`), only this round's accepted change.

  `git push` / `git merge main` are **not** done here by default — see §4.6.

  Under **`full-auto` (§1.A)**: the driver may run closeout **+ a local `git merge --ff-only` to main** without
  stopping, **only after** the closeout commit + self-verification (§1.C), and **fail-fast** (pause + report) if
  ff-only fails. **Remote** push/merge still escalate (§1.B.3 / §4.6).

### 4.5 Design pre-review trigger list

The driver does **not** request design pre-review by default; it **must** when any of these hold
(get the verdict back before implement):
1. new/changed external interface (HTTP API / handler signature / public function contract);
2. new/changed datastore schema or cache-key naming/invalidation rules;
3. new/changed permission model (RBAC / auth chain);
4. new/changed deploy path or scheduled job (service unit / cron / background worker / queue);
5. P0/P1 defect fix (affects production availability / main flow);
6. cross-tier change (frontend + backend contract change together);
7. ML / staged-pipeline boundary, training-data contract, or model-signature change;
8. production-visible behavior change (user-perceivable logic);
9. irreversible data operation (DDL / bulk DML / data migration);
10. estimated > half a day, or change clearly spans more than one module.

**When unsure, default to pre-review.** Land the pre-review verdict in the design doc or task
card's "design decisions" section. The `designReview` field (§6) is `done` / `skipped` / `required`.

### 4.6 Feature → main merge cadence

Once main is canonical, merge each feature soon after closeout (don't batch). The flow has **4
independent user confirmation points**; the driver reports at each and waits for explicit
go-ahead before the next — never bundling steps:
1. Driver completes the closeout commit on the feature branch.
2. **Confirm #1 (push feature):** driver asks; user approves → `git push origin <feature-branch>`.
3. **Confirm #2 (merge main):** user approves → `git checkout main && git merge --ff-only <feature-branch>`.
   If ff-only fails (main and feature diverged), pause and report — do not rebase/no-ff on your own.
4. **Confirm #3 (push main):** user approves → `git push origin main`.
5. **Confirm #4 (delete remote feature branch):** user approves → `git push origin --delete <feature-branch>`.
6. Update the task card's `code-home:` from `branch=…(unmerged)` to `merged-to-main@<sha>` as a separate doc commit.

These confirmation points are not auto-allowed by "execute per the SOP"; one "go ahead" does not
authorize a chain of remote git actions.

Under **`full-auto` (§1.A)**: `gated` keeps all four confirmation points. full-auto auto-advances only the
**local** actions — the closeout commit + `git checkout main && git merge --ff-only <feature-branch>` (after
self-verification; **fail-fast** if ff-only fails). **All remote actions always escalate** (§1.B.3):
`git push origin <feature-branch>`, `git push origin main`, `git push origin --delete <feature-branch>`, and any
publish/release. Even full-auto never bundles remote git actions.

### 4.7 git worktree for parallel sessions

When running multiple driver sessions on one machine in parallel, give each an isolated working
tree sharing one git history. Use only when needed (parallel tasks / a blocked session / branching
without disturbing the main worktree's uncommitted changes); plain sequential work does not need it.

**Recommended layout (sibling container):**
```text
~/projects/
├── <repo>/                    # main worktree (default session cwd)
├── <repo>-worktrees/          # sibling container (create once, reuse)
│   ├── <short-alias-1>/
│   └── <short-alias-2>/
```
- Keep the container **sibling** to the main worktree, not nested inside it (nesting doubles
  test/grep/index collection and needs `.gitignore` upkeep; user-level `~/worktrees` decouples
  from the repo and risks backup gaps; flat `<repo>-<branch>/` bloats the projects dir).
- Create the container once and reuse; `git worktree remove` a single worktree, keep the container.

**Commands:**
```bash
mkdir -p ~/projects/<repo>-worktrees
git worktree add ~/projects/<repo>-worktrees/<short-alias> -b <full-branch-name> main
git worktree remove ~/projects/<repo>-worktrees/<short-alias>
git worktree list
```

**Constraints:**
1. Two sessions must not run git index ops (`git add`/`commit`) concurrently against the same `.git`.
2. The review MCP server runs in the **main worktree only** by default; parallel sessions either
   forward to it or use manual mode. The bridge build (`dist/`) is a per-worktree artifact and the
   MCP server has no mid-session reload — a parallel worktree needs its own build + session restart.
3. `<full-branch-name>` aligns with the task card `design_id` for audit; the short path alias is convenience only.

## 5. Task card format

A plain-text file per round (e.g. `docs/plans/active/<design-id>-<phase>-implement.txt`), minimum:
```text
stage: implement
module: <module>
goal: <one verifiable point>
scope:
- only touch <files>
non-goals:
- ...
single-commit integrity: yes   # all changes are one atomic subject, one revertible commit
acceptance:
- <test command>
- scripts/verify_*.sh if needed
docs:
- update current.md + the design/impl doc
forbidden:
- do not commit
- do not touch unrelated files
```

## 6. Output contract

The driver gives structured output at implement / fix / closeout (self-checked even without an
auto-validating wrapper):
1. `docsRead` — docs actually used this round.
2. `sopChecks` — which SOP nodes were completed (contract lock, design sync, build/verify, handoff sync).
3. `filesInScope` / `filesChanged`.
4. `testsRun` — verification commands run.
5. `validationEvidence` — key logs / interface results / script PASS/FAIL excerpts.
6. `handoffUpdated` — whether the breakpoint doc was updated.
7. `commit` — whether a commit happened; non-closeout must be `performed=false`.
8. `mode` — `driver-led-reviewer-gate` | `driver-led-auto-review` | `reviewer-led-closed-loop`.
9. `designReview` — `required` | `skipped` | `done`.
10. `knownRisks` / `nextStep` — for quick reviewer triage.

## 6.A Run report (full-auto)

A **`full-auto` (§1.A)** run ends with a single **run report** (distinct from each segment's closeout),
aggregating the §6 fields over the run:
1. **delivered scope** per segment / slice;
2. each segment's **review chain** — verdicts + Critical/Important counts + `review_id`s;
3. **escalations raised + how each was resolved** (the §1.B stops);
4. **deviations** from the original plan;
5. **verification-evidence** summary (what was self-verified vs user-signed);
6. `code-home:` per segment;
7. **leftovers / backlog**.

It lands as a concise report in the final message + a durable run-summary pointer in `docs/records/current.md`
(no new per-run file by default).

## 8. The closed loop

### 8.0 Driver-led (default), 8 steps

(Under **`full-auto` (§1.A)**: steps 2–8 auto-advance per the §1.B predicate + §1.C self-verify boundary — the
user is called back only on an escalation; otherwise the run ends at a §6.A report.)

1. Clarify / brainstorm with the user (§4.2 cadence; exemptible).
2. Driver produces design + task card (`docs/plans/active/`); judges §4.5 pre-review need.
3. If complex / high-risk → design pre-review; land the verdict and adjust. Else skip.
4. Driver implements + self-tests + updates handoff/topic doc; outputs §6 fields.
5. Reviewer code review → 9.A/9.B/9.C/9.D graded findings.
6. Driver fixes (Critical before Important), looping to step 5 as needed.
7. User runs verify scripts.
8. After the user replies "test passed", driver closes out (§4.2 closeout). Push/merge per §4.6.

### 8.1 Reviewer-led closed loop (fallback), 7 steps

Used only when mode 3 is explicitly selected (§1):
1. Reviewer produces the design + task card.
2. Driver returns a structured execution plan (`plan` stage).
3. After the plan is confirmed, the driver implements (`implement` stage).
4. Reviewer reviews the driver's commit / diff / test results (9.A–9.D).
5. On findings, the driver fixes (`fix` stage); the reviewer only appends findings — it does not
   write code or test scripts itself.
6. The user tests locally or in the target environment.
7. Only after the user replies "test passed" does closeout run (the reviewer may perform it here).

## 9. Review framework

Roles of the four sections:
- **9.A** spec gate — against the task card: "was it done right".
- **9.B** general code-quality checklist — against project engineering standards.
- **9.C** module-specific checklist — projects attach their own subsections here.
- **9.D** grading + output format — every 9.A/9.B/9.C finding is graded and numbered per 9.D.

Order + failure handling:
1. Review in order 9.A → 9.B → 9.C.
2. Every finding uses the 9.D format `[Critical/Important/Suggestion] (9.x.y) …`.
3. If 9.A has a `Critical`: this round's fix card requires only the 9.A Criticals; non-Critical
   9.B/9.C findings are still listed and marked `deferred-to-next-round` (recorded, not dropped).
4. If 9.A passes: handle 9.B/9.C per the 9.D rules.

### 9.A Spec compliance
1. Did the driver implement the right module per design (not surface-only)?
2. Is test evidence sufficient for "ready to test"?
3. Is handoff state consistent with code state?
4. Did closeout happen only after the user's "test passed"?

### 9.B Code quality (general — adapt examples to `${STACK}`)
1. **Logging gated through helpers** — no raw ad-hoc logging for SQL/cache/profile/inflight/etc.
2. **No wall-clock in handlers where a simulation/virtual clock is threaded** — thread the time context.
3. **Cache-layer consistency** — a new cache key invalidates all layers together (e.g. distributed
   cache + in-process LRU); **never a global flush** (`FLUSHALL`-class). (forced — SOP §6.4)
4. **Optional-dependency nil/None checks** at handler entry so a missing service degrades, not panics.
5. **Concurrency hygiene** — new goroutines/tasks have exit paths; context is plumbed; errors not swallowed.
6. **Config over hard-coding** — table/topic/queue names env-overridable, not hard-coded.
7. **Frontend** — reuse shared polling-interval/permission constants; mirror new permission flags across tiers.
8. **Commit** — single-subject, conventional-commits, no mixed unaccepted/unrelated changes. (forced)

> §9.B examples above are stack-shaped; keep the *principle* and adapt the concrete check to your
> stack. Stack/env-specific checks (CRLF-on-upload, transfer rate limits, host deploy constraints)
> belong in `docs/runbooks/` as hooks, not here.

### 9.C Module-specific checklist
Empty by default. A project adds a `9.C.<n> <module>` subsection with that module's invariants
(determinism/ordering, dependency minimization, cross-language schema contracts, fail behavior,
time boundaries / no-lookahead, fixture isolation, pipeline boundaries, eval/gate coverage). Mark
each declared eval dimension `COVERED / PARTIAL / MISSING`; `PARTIAL`/`MISSING` must be registered
as deferred with a closing plan, never silently passed.

### 9.D Grading (Critical / Important / Suggestion)
| Level | Meaning | Handling |
|---|---|---|
| `Critical` | Blocks closeout: bug, data loss, security/permission hole, hard-constraint violation (unauthorized commit, global flush, any 9.A miss) | Must fix; no closeout until fixed |
| `Important` | Should fix this round: a 9.B/9.C violation, clear bad smell, latent fault | Fix this round; may `deferred-to-next-round` if out of scope or 9.A Criticals fill the round |
| `Suggestion` | Style, readability, small optimization, preventive rewrite | Note it; non-blocking; the driver may decline + backlog |

`Critical` must cite a concrete trigger or hard-constraint clause — not "feels severe". The fix
card lists findings by level; fix **Critical before Important**, never out of order.

### 9.E Convergence + stop-loss (when does the fix loop stop)
1. **Per-round accounting (forced):** in auto mode read `verdict_factors.critical_count` /
   `important_count` from the envelope; in manual mode record `round N: Critical=a Important=b`.
   Track **carried-over Criticals** (same `conclusion_id`/root cause recurring after being marked resolved).
2. **Normal vs stall:** Critical counts may rise then fall (new sub-issues found — normal for big
   tasks). **Stall (must stop)** if any: ① the same Critical is unresolved 2 rounds running; ② the
   Critical total fails to drop 2 rounds running; ③ fixes ping-pong regressions between the same points.
3. **On stall:** do not auto-continue. Report to the user: the stuck finding (id + one-line root
   cause), why it won't move, and ≥2 options. The user decides.
4. **Round cap + escalation:** auto mode has the `max_review_rounds` breaker; manual mode has a soft
   cap (default ~5) — at the cap with Criticals open, escalate to the user, don't auto-restart.
5. **Single-source first:** repeated drift of a truth table / contract is a common stall root cause;
   check the single source before fixing symptoms round after round.

### Exemptions
- 9.B/9.C are forced only at implement/fix when the task affects code behavior.
- Single-file copy/comment/pure-doc changes (`docs/**`, `README.md`) are exempt from 9.B/9.C.
- Tasks touching source/build/deploy scripts are **not** exempt.
- 9.D soft exemption: ≤ 2 findings, all `Suggestion` → prose is fine; any ≥ `Important` → full 9.D format.

## 10. Recommended practice

1. Give the driver one acceptable sub-item per round, not a cross-phase mega-task.
2. In `fix`, feed only the review findings, not the whole requirement again.
3. Trust the reviewer's read of the real diff over the driver's self-assessment.
4. If a task depends on a running service, the card states "confirm the process is restarted to the latest build".
5. If a task depends on cache/log verification, the card requires the incremental log window + two-request method.
6. For highest quality, default to the strongest model + max effort; lower only under cost/rate limits (see `model-tier-strategy.md`).
7. If the driver is stuck implementing, the reviewer may analyze/triage but must not take over the implementation.

### 10.A Context engineering / subagent offload (driver side)
Single-thread deep work is the default; offload is **criteria-based, not default**.

**Offload to a sub-agent** (fresh context, returns conclusions not file dumps) when:
1. broad fan-out search across many dirs/conventions where you only need the conclusion;
2. an independent, parallelizable probe weakly coupled to the main line;
3. a one-shot large-token task whose output compresses to a few lines (whole-repo grep summary, external-doc skim).

**Do not offload** when: deep work needing accumulated cross-step context; work that changes main
code or that you'll keep operating on; conclusions that depend on lots of intermediate state.

**Context budget awareness:** on long sessions, watch the context level; near the threshold, land a
`/handoff` breakpoint (and compact if needed) rather than pushing into context rot.
