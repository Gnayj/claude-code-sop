# ccsop Codex skill host contract v1

- Minimum Codex CLI: `0.145.0-alpha.2` using standard semver prerelease ordering.
- Canonical root: `.agents/skills`; legacy root: `.codex/skills`.
- Required five discoverable entries: `project-sop`, `handoff`, `simplify`, `sop-flow`, `sop-tier`.
- A below-minimum, missing, or unparseable host preserves existing bytes/pointer and creates no canonical duplicate.
- Legacy migration is pristine-provenance only; rollback entry: `--rollback-codex-skills`.
