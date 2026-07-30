# ccsop flow contract v2

- Der Claude-Befehl akzeptiert nur `claude+claude` / `claude+codex`.
- Der Codex-Skill akzeptiert nur `codex+codex` / `codex+claude`.
- Leere Argumente und implizite Aufrufe sind schreibgeschützt; explizites Setzen ruft `ccsop_configure` auf.
- Eine fehlende, alte oder nicht neu gestartete Bridge führt zu null Schreibvorgängen und einem Hinweis zum erneuten Verbinden über `/mcp`.
- Der Status einer ungültigen Konfiguration liefert Fehler/Rohwerte der Owner; explizites Setzen repariert Zielschlüssel nur nach erfolgreicher Gesamtvalidierung, andernfalls gibt es null Schreibvorgänge.
- Schema 1 erhält Phase 1: `codex+claude` verwendet `manual relay`; Flow- und Codex-Tiers bleiben nutzbar.
- Mit Schema 2 und `claude_implement` im Bridge-Katalog kann `codex+claude` den Proposal-Adapter verwenden; der Flow aktiviert ihn nie automatisch.
- Ein Wechsel des Implementierungs-Owners erzwingt atomar `[implement.claude].enabled=false`; nur ein Operator außerhalb der Agent-Session darf ihn wieder aktivieren.
- Shell-/manuelle-TOML-Fallbacks sind verboten; Schema-Migration und Rollback verwenden ausschließlich serverseitig festgelegte Aktionen.
