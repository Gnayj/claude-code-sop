# Project Delivery SOP (reusable template)

> ccsop canonical (English). `/sop-init` materializes this into your repo; `/sop-lang`
> re-materializes it in another language. Machine-stable surfaces (verdict enums, `§`
> anchors, the `code-home:` field name and its values, config keys, command names) are
> preserved verbatim across translation.

## 1. Goal & scope

1. Goal: make requirement → implementation → test/acceptance → documentation a single closed
   loop, so context is never lost and never re-derived.
2. Scope: this project and later projects of the same shape (replace `${STACK}` with yours —
   e.g. backend + frontend + database + cache + ops/deploy).

## 2. Principles

1. Contract first, code second: confirm the behavior contract and acceptance criteria before implementing.
2. Small steps: advance one independently verifiable sub-item at a time.
3. Not done until accepted: "implemented" ≠ "done"; a change is done only after the test gate passes.
4. Docs are the breakpoint: every key change lands in docs so work can resume cold.
5. Analyze on the merits: conclusions and trade-offs are judged only on correctness, performance,
   stability, maintainability, risk, and cost/benefit — never to flatter the user's preference.
6. Be truthful: it is allowed (and expected) to conclude "this approach is not optimal" or
   "this should be redone", but always with concrete reasons and an alternative.

## 3. Standard doc structure (per project)

1. `docs/records/current.md` — current state, done, not-done, key interfaces, next step.
2. `docs/records/archive/<period>.md` — historical increments archived by quarter/phase.
3. `docs/methodology/` — delivery SOP, collaboration protocol, workflow overview, model-tier strategy.
4. `docs/plans/active/` and `docs/plans/completed/` — active and completed task cards.
   - On archival, append a `code-home:` line recording the current factual state. Legal values:
     - `code-home: merged-to-main@<sha>` — merged to main.
     - `code-home: branch=<branch>@<sha>(unmerged)` — on a feature/trunk branch, not yet on main.
     - `code-home: deployed@<sha>` — deployed to production, not necessarily on main.
     - `code-home: doc-only` — task card touched docs only; no code home.
     - `code-home: superseded-by@<sha>` — overwritten/replaced by a later commit.
     - `code-home: reverted@<sha>` — explicitly reverted.
   - This field records *current fact*; it does not force merge at closeout. The point is that
     months later you can answer "where does this task's code live now" without drift between
     the task card's archived state and the real deploy state.
5. `docs/design/` — module-level feature designs and architecture.
6. `docs/runbooks/` — environment, deploy, run, and verification steps (stack-specific hooks live here).
7. `docs/references/` — schemas, generated artifacts, static reference material.

## 4. Requirement → ship flow

1. Requirement clarification
   - Output: scope, non-goals, data contract, performance targets, acceptance criteria.
   - Do not enter coding until the contract is clear.
   - **Chunked confirmation (default on, exemptible)**: the round's design owner (the driver
     under `Driver-led + reviewer gate`, the reviewer after falling back to `dual closed-loop`)
     first raises just "business goal + acceptance signal" for the user to confirm, then fills
     in scope/non-goals/contract/risk. Goal: give the user ≥2 independent verification points
     rather than one big block + a single "OK". Exemptions (a draft may be given directly):
     1. the user already gave enough goal + acceptance contract to write scope without asking back;
     2. read-only tasks: review, status queries, log/interface diagnosis, doc surveys, history tracing — no code change;
     3. the "is-it-a-defect" triage phase of a bug — chunked confirmation comes after it's
        confirmed a real defect and a fix approach is needed;
     4. clearly < ~30 min fixes with no data contract, no new interface, no perf target (incl. pure copy/comment/typo).
2. Design
   - Output: API/SQL/cache/schema/permissions/risk/rollback plan.
   - Needs user confirmation that "the plan is executable" before coding.
3. Incremental implementation
   - Implement one sub-item at a time; avoid large changes that are hard to regress.
   - Must compile and run after implementation.
4. Self-test + evidence
   - Minimum: build passes + key-path verification + log evidence (MUST use an **incremental log
     window** — never `tail` the whole log to judge; see §6.4).
5. User test
   - Provide a "copy-paste runnable" test command + pass criteria.
   - The developer runs the same verification script locally first, then hands it to the user.
   - If the change touches a server binary / frontend build / script-dependent runtime AND the
     verification reuses an *already-running process / deployed service*, first confirm that
     process was restarted / redeployed to this round's build — otherwise results from the old
     process are invalid (see §6.4.6).
   - Update the breakpoint doc (`docs/records/current.md` + the relevant topic doc) before handing off.
6. Done decision
   - A sub-item is `done` only after the user explicitly replies "test passed".
   - **Doc / methodology / read-only changes** (no runnable "test"): done signal = code/design
     review Pass (or an explicit exemption) + user confirms closeout; do not wait for the words
     "test passed". See §6.2.
7. Doc closeout
   - Update `current.md` (done / not-done / next step). Large changes also update the feature/archive docs.
8. Commit closeout
   - After the done decision, commit "this round's accepted change" on its own.
   - Finish doc + breakpoint updates first, then `git commit`.
   - Unaccepted/unrelated/temporary-debug content must not be mixed into that commit unless the
     user explicitly asks.
9. Parallel session isolation
   - When multiple sessions advance different tasks, create a git worktree per
     `claude-code-sop-collaboration.md §4.7` (sibling-container path pattern).

## 4.1 Delegated collaboration rules (reduce repeated confirmation)

1. When the user says "execute per the SOP after the plan is confirmed", the default meaning is:
   - the agent may directly perform non-destructive implementation, build, test, formatting, log
     analysis, targeted cache clears, `git add`, `git commit`;
   - once the user replies "test passed", the agent commits the accepted change per "commit closeout".
2. If the platform still requires authorization, the agent should request the **minimal reusable
   prefix** (persistent) rather than re-asking per command, and not re-ask verbal consent for the
   same class of non-destructive command.
3. "Execute per the SOP" does not bypass the platform permission system — it means the agent acts
   by default and uses minimal/persistent authorization for commands that require it.
4. The following ALWAYS require separate explicit confirmation (never auto-allowed by "per the SOP"):
   - deleting, overwriting, rolling back, or resetting unrecoverable content;
   - destructive ops (`rm`, `git reset --hard`, `git checkout --`, …);
   - changing production config or services;
   - overwriting database data, irreversible DDL/DML;
   - deploy / restart / wipe / bulk-write against a production environment.

## 5. Feature checklist (tick at execution)

1. Requirement contract locked (incl. boundary conditions).
2. Design doc updated.
3. Implementation complete.
4. **`/simplify` pre-test pre-screen run or exempted** (see §5.A). If triggered, run `/simplify`
   and self-fix all issues before the next step; if exempted, record the reason in self-test evidence.
5. Build passes (e.g. `${BUILD_CMD}`).
6. Key-path test script runnable.
7. Logs observable (hit/fallback/latency/error-cause).
8. Cache scenarios provide a **targeted cache-clear** command (`FLUSHALL` is banned).
9. User test command provided (script preferred).
10. User confirms done (regular = "test passed"; doc/methodology/read-only per §6.2 = review Pass + user closeout).
11. Breakpoint doc updated.
12. Accepted change committed on its own, or explicitly recorded why not yet.
13. If the user declared "per the SOP", the authorization-prefix strategy followed the minimal-reusable principle.

### 5.A `/simplify` pre-test pre-screen (default forced)

`/simplify` is a Claude Code built-in skill ("Review changed code for reuse, quality, and
efficiency, then fix any issues found"), used as a cheap local pre-screen *before* the reviewer
gate (`codex_code_review`) to filter dead code / duplication / over-abstraction and cut reviewer rounds.

**Trigger (machine criteria):**
- changed-file suffix ∈ a code allowlist (e.g. `.go .ts .tsx .js .py .vue .sh` — adapt to `${STACK}`);
- feature branch add+del vs base ≥ 30 lines (committed + staged + unstaged + untracked);
- base ref defaults to `main`; not a git repo / no `main` / detached HEAD → skip → exempt (record reason);
- otherwise (pure docs / SOP / typo / tiny fix / suffix not in allowlist) → exempt.

**Flow (when triggered):** invoke `/simplify` → if "no issues" go to build → if issues, fix
in-place and re-run until no issues (or remaining items confirmed non-issues with an inline note)
→ then self-test → reviewer gate.

**Unavailable fallback:** if the skill can't be invoked for any reason, skip the pre-screen,
record `"/simplify skipped: <reason>"` in self-test evidence, **do not block**, proceed to the reviewer gate.

**Relationship to the reviewer gate:** `/simplify` does not replace the reviewer. It catches
cheap local reuse/quality/efficiency issues; the reviewer still covers architecture / scope drift
/ cross-cutting consistency. Orthogonal and serial (implement → /simplify → self-fix → self-test → review).

## 6. Test SOP (unified decision)

### 6.1 Test layers

1. Build: does it compile/package?
2. Interface: main responses, error branches, permission branches.
3. Performance: key-path latency, cache hit rate, origin-fetch behavior.
4. Regression: are old features broken?

### 6.2 Pass criteria (all required)

1. Behavior matches the plan.
2. No new blocking errors (P0/P1).
3. Key logs and metrics match expectation.
4. User explicitly replies "test passed".

**Doc / methodology / read-only changes** (no runnable test): 1–4 do not apply; the done signal is
**review Pass (`codex_code_review` / `codex_design_review` Pass / All-fixed, or an explicit
exemption) + user closeout**. Doc-only changes still use a single-subject commit + doc closeout,
but do not require the words "test passed".

Under **`full-auto`** (`claude-code-sop-collaboration.md §1.A`): the driver's self-verification substitutes for
the user's "test passed" **only** for machine-checkable acceptance (build / tests / grep-schema-drift
invariants / spec-conformance). **Subjective quality, real-environment / production acceptance, and the §4.1
always-confirm actions still require the user** (collaboration §1.B / §1.C).

### 6.3 On failure

1. Keep the failing log + repro command.
2. Mark state `testing_failed`.
3. After the fix, re-run the same verification.

### 6.4 Cache & log verification standard (default forced)

1. **Incremental log window**
   - Record the start line before each verification: `N=$(wc -l < ${LOG_PATH})`.
   - After verifying, view only the increment: `tail -n "+$((N+1))" ${LOG_PATH}`.
2. **Cache-hit verification (two-request method)** *(applies when the stack has a cache layer)*
   - First request may fetch from origin; the second same-params request must hit cache.
   - Acceptance must show both: origin-fetch count + cache-hit count.
3. **Fallback-path verification (remove cache interference)**
   - Clear only the *target* cache key/pattern before verifying fallback (never a global flush).
4. **Scripted verification (preferred)**
   - Every high-frequency/complex path should have a `scripts/verify_*.sh` that prints `PASS/FAIL`
     and includes key log excerpts. Developer runs it locally first, then the user re-tests.
5. **Log-judgment constraint**
   - Never judge "pass" from stale historical logs — use this round's incremental log + the current response.
6. **Process-version consistency (default forced)**
   - If verification depends on a running service process, do not start testing while the code is
     changed but the process is not restarted/redeployed; confirm the interface runs this round's
     build first.

> Stack-specific verification hooks (e.g. CRLF-on-upload checks, transfer rate limits, host-specific
> deploy constraints) live in `docs/runbooks/` as configurable hooks — see §2.3 of the design and
> the runbooks index. Keep the *forced* bucket above unconditional; only stack/env items are configurable.

## 7. Backlog management SOP

### 7.1 States
`todo` (not started) · `in_progress` (developing) · `testing` (awaiting user test) · `done`
(user confirmed) · `blocked` (dependency/env) · `cancelled`.

### 7.2 Priorities
`P0` (blocks main flow / production outage) · `P1` (core feature missing or clear perf problem) ·
`P2` (UX / maintainability) · `P3` (long-term improvement).

### 7.3 Record template
```text
[ID] [P1] [in_progress] <module>: <one-line item>
- Context: ...
- Contract: ...
- Acceptance: <log keyword + interface behavior + perf target>
- Evidence: <log keyword + interface result>
```

## 8. Doc update rules (forced)

1. Every completed sub-item updates `current.md`.
2. Every major feature has at least one topic doc (design or validation).
3. Long/stacked historical logs move to `archive`; current docs stay readable.
4. "Not-done" items in docs must match real code state.

## 9. Commit & release rules

1. One commit, one subject — no mixed changes (single-subject commit, forced).
2. Before commit, at least: build passes, key tests pass, docs synced.
3. Before release, add: config check (env, permissions, connection info) + a rollback path.
4. New external dependency legitimacy (GSD slopcheck idea): before installing an AI-recommended or
   newly-introduced third-party dep, verify it — official source / correct spelling (anti
   typo-squat) / active maintenance / the version really exists; confirm non-standard deps with the
   user, never install silently.

## 10. Breakpoint recovery (on context loss)

1. Read `docs/records/current.md` first (or run `/handoff`).
2. Then the relevant topic doc (design/validation).
3. For history, read the matching `docs/records/archive/<period>.md`.
4. After recovering, state "current state + next step" before changing anything.

## 11. Reusable resume prompt

```text
Continue per the SOP:
1) Module: {...}
2) This sub-item: {one verifiable point}
3) Acceptance: {log keyword + interface behavior + perf target}
4) Rule: mark done only after I reply "test passed"
5) Execute: after plan confirmation, advance per the SOP for non-destructive/low-risk actions,
   requesting minimal persistent authorization
6) Require: keep current.md + the topic doc in sync
```

## 12. Bug SOP (defects)

### 12.1 Flow
1. Triage — priorities `P0`–`P3` per §7.2; `P0` (production block) stop-the-bleed first, `P1` fix first.
2. Repro — steps, expected, actual, blast radius; freeze evidence (log/SQL/response/screenshot, ≥1).
3. Stop-the-bleed (P0/P1) — toggle/degrade/rollback/throttle to restore availability with minimal risk.
4. Root cause — "direct cause + trigger + why not exposed before".
5. Fix — minimal closed change; avoid large refactors inside a defect fix.
6. Verify + regress — defect path re-passes; related paths regress clean.
7. Done — `done` only after the user replies "test passed".
8. Doc closeout — update `current.md`: symptom, root cause, fix, verify command, state.
9. Freeze verification — fold the defect's verify script/command into the SOP or the feature
   validation doc as the default for similar issues.

### 12.2 Defect states
`todo` · `in_progress` · `mitigated` (P0/P1 only) · `testing` · `done` · `reopened`.

### 12.3 Defect card template
```text
[BUG-ID] [P1] [in_progress] {module}
- Symptom / Repro / Expected / Actual / Blast radius / Evidence
- Root cause / Mitigation / Fix / Verify command / Pass criteria / State
```

## 13. Spike SOP (feasibility experiments)

When approach/contract/performance is unknown and you must run an experiment before choosing a
direction, run a spike instead of advancing it as an implement. Goal: separate "trial-and-error"
from "delivery" so probe code does not leak into the main/production path.

### 13.1 When it's a spike
1. Feasibility / perf ceiling / data contract unknown — prove "can it / is it worth it" first.
2. A/B comparison, bisection, profiling — temporary experiments for a conclusion only.
3. Approach already decided, only writing the implementation → **not** a spike; normal flow.

### 13.2 Probe code placement (forced)
1. Prefer **disposable standalone scripts** (`scripts/spike_*`, `scripts/probe_*`); do not mix into main/production code.
2. If main code must be touched: isolate with an explicit toggle (default off) AND register the
   "temporary probe change + cleanup obligation" in the handoff or task card.
3. One-way dependency: main code must not import probe scripts.

### 13.3 Verdict (three states)
End each spike with one line: `VALIDATED / INVALIDATED / PARTIAL` + one-line evidence + data/log
anchor (line number, commit, table, latency number). Never "tried it, felt fine".

### 13.4 Cleanup / consolidation (forced, pick one)
1. **Delete** — remove throwaway code; if main code was touched, clean before closeout (see §14).
2. **Consolidate** — promote durable value to `scripts/verify_*.sh` or a baseline/degraded toggle
   (keep the old path as fallback + A/B, do not overwrite).
The verdict itself (verdict + evidence + trade-off) lands in the design's implementation-record section or records.

## 14. Closeout integrity self-audit (GSD forensics)

§5 checks "did I do this round's work" *before test*; §14 is a forensic re-check *at closeout* —
"did state drift / leftovers creep in". Run it by hand before closeout:

1. `current.md` "not-done / next-step" matches real code state — no mis-set status, no stale done items.
2. `git status` clean — no leftover uncommitted changes, no abandoned diff, no temp debug output (`console.log` / `print` / temp logs).
3. Probe / diagnostic patches cleaned (per §13.2 registration); no bare temp toggles in main code.
4. No half-baked commit or orphan branch from an abort/interrupt.
5. Archived task cards' `code-home:` lines are real and checkable (against the actual commit/branch/deploy).
6. New deps (if any) verified per §9.4.
