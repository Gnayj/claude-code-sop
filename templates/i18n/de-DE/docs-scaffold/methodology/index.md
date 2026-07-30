# Methodikindex

Die CCSOP-Bereitstellungsmethodik (CCSOP Canonical; `owner=ccsop`, aktualisiert über `/sop-update`). Gelesen von
topic:

| Doc | Was es abdeckt |
|---|---|
| [`project-delivery-sop.md`](project-delivery-sop.md) | Die Liefer-SOP: Prinzipien, Dokumentenstruktur, Anforderung → Versandablauf, Funktionscheckliste, Test-SOP (inkrementelles Protokollfenster / zwei Anfragen / kein globaler Flush), Commit & Release, Bug-SOP, Spike-SOP, Abschluss-Selbstprüfung. Eine einzige Regelquelle. |
| [`claude-code-sop-collaboration.md`](claude-code-sop-collaboration.md) | Kollaborationsprotokoll: die 3 Modi (vom Fahrer geleitet + Prüfer-Gate / + automatische Prüfung / vom Prüfer geleiteter Fallback), Rollen, obligatorische Eingaben, Aufgabenkartenkonvention, §4.5 Design-Vorprüfungsauslöser, §4.6 Zusammenführungsbestätigungspunkte, §4.7 Arbeitsbaum, §6 Ausgabevertrag, §9.A–§9.E Prüfrahmen, §10.A Subagenten-Offload. |
| [`workflow-overview.md`](workflow-overview.md) | Durchgängiges Flussdiagramm, Artefakte pro Stufe, Fehlermodi, Rollback-Playbook. |
| [`model-tier-strategy.md`](model-tier-strategy.md) | Welche Modellstufe für welche Stufe (stark für Urteilsvermögen, günstiger für mechanisch, frischer Kontext für Fan-Out, unabhängig für Überprüfung) + die Agent-in-Cron-Grenze. |

Starten Sie eine Sitzung mit `/handoff` (oder lesen `../records/current.md`); die `project-sop` Geschick ist das
Ausführungskarte, die hierher zeigt.
