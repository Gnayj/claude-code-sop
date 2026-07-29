# ccsop Codex skill host contract v1

- 最低 Codex CLI：`0.145.0-alpha.2`（按标准 semver prerelease 排序）。
- canonical root：`.agents/skills`；legacy root：`.codex/skills`。
- 必须存在的五个 discoverable entries：`project-sop`, `handoff`, `simplify`, `sop-flow`, `sop-tier`。
- 低于最低版本、缺失或无法解析的 host：保留现有 bytes/pointer，禁止创建 canonical duplicate。
- legacy migration 仅限 pristine provenance；回滚入口：`--rollback-codex-skills`。
