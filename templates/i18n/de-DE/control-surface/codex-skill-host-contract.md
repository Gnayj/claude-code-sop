# ccsop Codex skill host contract v1

- Minimale Codex CLI: `0.145.0-alpha.2` nach standardmäßiger semver-Prerelease-Sortierung.
- Kanonisches Root: `.agents/skills`; Legacy-Root: `.codex/skills`.
- Erforderliche fünf auffindbare Einträge: `project-sop`, `handoff`, `simplify`, `sop-flow`, `sop-tier`.
- Ein zu alter, fehlender oder nicht auswertbarer Host bewahrt vorhandene Bytes/Pointer und erzeugt kein kanonisches Duplikat.
- Die Legacy-Migration ist auf pristine Provenance beschränkt; Rollback-Einstieg: `--rollback-codex-skills`.
