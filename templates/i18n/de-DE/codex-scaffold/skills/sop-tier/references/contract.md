# ccsop tier contract v2

- `claude-review` → `[review.claude] backend/model/effort`.
- `codex-review` → `[review.codex] model/effort`.
- `codex-dispatch` → `[implement] model/effort` (steuert nur `codex_implement`).
- `codex-default` → `[codex] default_model/default_effort`.
- Schema 2 ergänzt `claude-implement` → model/effort in `[implement.claude]` sowie nur verkleinerbare timeout/output/budget/ledger-Grenzen.
- backend/cli_path/Versions-Overrides/Validierung/additive Globs/advisory apply/enabled sind operator-only und werden vom Tool abgelehnt.
- Für Modell/effort der aktuellen Codex-Host-Session ist das integrierte `/model` zu verwenden.
- Leere Argumente und implizite Aufrufe sind schreibgeschützt; explizites Setzen ruft `ccsop_configure` auf.
- Der Status einer ungültigen Konfiguration liefert Fehler/Rohwerte der Tiers; explizites Setzen repariert Zielschlüssel nur nach erfolgreicher Gesamtvalidierung, andernfalls gibt es null Schreibvorgänge.
- Schema 1 lehnt `claude-implement` weiterhin ab; Schema 2 verlangt zusätzlich ein echtes Tool `claude_implement` im Katalog.
