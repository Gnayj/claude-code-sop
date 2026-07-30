# docs/ – Layering-Karte

Dieses Repository folgt dem **ccsop**-Bereitstellungsworkflow. Die Dokumentation ist mehrschichtig:

| Dir | Hält |
|---|---|
| `records/` | `current.md` (Live-Haltepunkt) + `archive/<period>.md` (historische Zuwächse) |
| `methodology/` | Liefer-SOP, Kollaborationsprotokoll, Workflow-Übersicht, Modellebenenstrategie (ccsop kanonisch; aktualisiert über `/sop-update`) |
| `plans/` | `active/` + `completed/` Aufgabenkarten und die `_template-{design,implement}.txt` Vorlagen |
| `design/` | Feature-Designs und Architektur auf Modulebene |
| `runbooks/` | Umgebung, Bereitstellung, Ausführung, Überprüfungsschritte (stack/env-specific Haken) |
| `references/` | Schemata, generierte Artefakte, statisches Referenzmaterial |

**Hier beginnen**: aufrufen `/handoff` (oder lesen `records/current.md`) für den aktuellen Zustand. Regeln leben in
`methodology/project-delivery-sop.md` (einzelne Quelle); die `project-sop` Fertigkeit ist die Ausführungskarte.

Die Herkunft der verwalteten Dateien wird nachverfolgt `.ccsop/manifest.json` (pro Dateibesitzer + source/render
Hashes sowie ein Quell-Hash der gepflegten Übersetzung für übersetzte Dokumente). Dateien mit `owner=ccsop`
werden gepflegt von `/sop-update`; `records/current.md` ist `owner=overlay` (Dein). Um Ihre eigenen hinzuzufügen
Wenn Sie Inhalte **innerhalb** eines verwalteten Markdown-Dokuments erstellen möchten, ohne ihn zu forken, packen Sie ihn in einen Consumer-Erweiterungsblock ein
(`<!-- consumer:begin <slug> anchor="<section>" -->` … `<!-- consumer:end <slug> -->`) – Aktualisierungen
Bewahren Sie es an Ort und Stelle auf.
