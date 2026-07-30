---
name: sop-tier
description: Verbrauchte CCSOP-Überprüfung und Codex anzeigen oder explizit festlegen dispatch/default Modellaufwandsstufen aus einer Codex-Sitzung.
---

# SOP-Stufe

Lesen `references/contract.md`.

- Leere Argumente oder implizite Aktivierung sind schreibgeschützt: Aufruf `ccsop_configure action=status`.
- Zulässige Schema-1-Bereiche sind `claude-review`, `codex-review`, `codex-dispatch`, und
  `codex-default`. Schema 2 stellt zusätzlich dar `claude-implement`.
- Eine explizite Mutation liest zuerst den Status und erfordert `contract_version=2` /
  `observed_schema=1|2`, dann ruft `ccsop_configure action=set-tier` mit dem Status sha und nur
  Die dokumentierten Felder des ausgewählten Bereichs.
- Wenn Statusberichte `config_valid=false`, zeigen Sie den Validierungsfehler und die Rohebenen an. Ein legaler Satz
  kann die ausgewählten Zielschlüssel nur reparieren, wenn die resultierende gesamte Konfiguration validiert ist; unabhängig
  Fehler schlagen mit null Schreibvorgängen fehl. Zeigen Sie auf `/sop-update` oder eine verifizierte
  `.ccsop/backups/config/<sha256>.toml` Vorbild, niemals ein Fallback für die manuelle Bearbeitung.
- Codex-Aufwand: `""|minimal|low|medium|high|xhigh`. Claude-Rezensionsaufwand:
  `""|low|medium|high|xhigh|max`; Claude Review Backend ist `api|cli`.
- `claude-implement` erfordert Schema 2 plus ein Live `claude_implement` Werkzeug. Es akzeptiert
  model/effort und nur zum Schrumpfen geeignet timeout/output/per-design/daily Budgetobergrenzen. Niemals versenden
  Backend, cli_path, Versionsüberschreibung, Validierung paths/commands/globs, beratend anwenden, oder
  aktiviert: Diese sind nur für den Bediener verfügbar. Ein oben angefordertes Limit
  `min(on-disk current, compiled maximum)` ist ein Null-Schreibfehler.
- `codex-dispatch` Kontrollen `codex_implement`, nicht die aktuelle Hostsitzung. Verwenden Sie integrierte `/model`
  für die aktuelle Codex-Sitzung.
- Lehnen Sie jeden anderen Bereich ab. Bei Schema 1 schlägt fehl `claude-implement` mit`/sop-update`Sanierung
  unter Beibehaltung der Phase-1-Umfänge. Auf einem missing/old/unrestarted Werkzeug, null Schreibvorgänge durchführen, geben `/mcp`
  Stellen Sie die Führung wieder her und greifen Sie nie wieder auf die manuelle Steuerung zurück TOML/shell Bearbeiten.
