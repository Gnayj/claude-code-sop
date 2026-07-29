# ccsop flow contract v1

- The Claude command accepts only `claude+claude` / `claude+codex`.
- The Codex skill accepts only `codex+codex` / `codex+claude`.
- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.
- A missing, old, or unrestarted bridge causes zero writes and `/mcp` reconnect guidance.
- Invalid-config status returns the error/raw owners; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.
- `codex+claude` delivery is `manual relay` in Phase 1.
- Config schema must be `1`; shell and manual-TOML fallbacks are forbidden.
