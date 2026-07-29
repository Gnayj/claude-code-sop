# ccsop flow contract v2

- The Claude command accepts only `claude+claude` / `claude+codex`.
- The Codex skill accepts only `codex+codex` / `codex+claude`.
- Empty arguments and implicit triggers are read-only; explicit sets call `ccsop_configure`.
- A missing, old, or unrestarted bridge causes zero writes and `/mcp` reconnect guidance.
- Invalid-config status returns the error/raw owners; explicit set repairs target keys only when whole-config validation passes, otherwise zero writes.
- Schema 1 preserves Phase 1: `codex+claude` is manual relay and flow/Codex tiers remain usable.
- With schema 2 and `claude_implement` in the bridge catalog, `codex+claude` can use the proposal adapter; flow never auto-enables it.
- Changing implement owner atomically forces `[implement.claude].enabled=false`; only an operator outside the agent session may re-enable it.
- Shell/manual-TOML fallbacks are forbidden; schema migration and rollback use server-fixed actions only.
