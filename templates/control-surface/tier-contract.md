# ccsop tier contract v1

- `claude-review` → `[review.claude] backend/model/effort`.
- `codex-review` → `[review.codex] model/effort`.
- `codex-dispatch` → `[implement] model/effort` (`codex_implement` only).
- `codex-default` → `[codex] default_model/default_effort`.
- Use the built-in `/model` for the current Codex host session model/effort.
- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.
- Invalid-config status returns the error/raw tiers; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.
- Phase 1 rejects every unpublished implement scope.
