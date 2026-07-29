---
name: simplify
description: Classify the current change against the ccsop simplify threshold, then review reuse, quality, efficiency, and coverage; explicit invocation fixes findings and reruns focused tests.
---

# Simplify

Read `references/contract.json`; it is the machine truth. Do not parse thresholds from methodology
prose.

1. Verify this is a git feature branch with the configured base ref. Otherwise report `EXEMPT`
   with the exact reason.
2. Sum add+delete lines for allowed code suffixes across committed, staged, unstaged, and
   untracked changes without double-counting paths. Report the per-segment evidence.
3. Below the threshold or with no eligible suffix: report `EXEMPT`. Otherwise report `TRIGGER`.
4. Review the changed code from four angles: reuse, quality, efficiency, and coverage.
5. On explicit `$simplify` or an explicit user request to simplify and fix, edit only in-scope
   files, fix real findings, rerun focused tests, and report evidence. On an implicit trigger,
   diagnose only and ask before editing.

This is a cheap pre-screen, not a replacement for the required cross-model code review.
