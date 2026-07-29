# ccsop tier contract v2

- `claude-review` → `[review.claude] backend/model/effort`.
- `codex-review` → `[review.codex] model/effort`.
- `codex-dispatch` → `[implement] model/effort` (`codex_implement` only).
- `codex-default` → `[codex] default_model/default_effort`.
- Schema 2 adds `claude-implement` → `[implement.claude]` model/effort and shrink-only timeout/output/budget/ledger caps.
- backend/cli_path/version overrides/validation/additive globs/advisory apply/enabled are operator-only and rejected by the tool.
- Use the built-in `/model` for the current Codex host session model/effort.
- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.
- Invalid-config status returns the error/raw tiers; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.
- Schema 1 still rejects `claude-implement`; schema 2 also requires a real `claude_implement` tool in the catalog.
