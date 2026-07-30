---
name: project-sop
description: Codex-seitiger Workflow-Skill für dieses Repository (ccsop). Wird verwendet, wenn eine Codex-CLI-Sitzung eine Aufgabe steuert (Entwurfseigentümer) oder eine Aufgabe implementiert (Implementierungseigentümer) gemäß der Liefer-SOP des Projekts – Funktionsarbeit, Fehlerbehebungen, Überprüfungen und alle Aufgaben, die dem Übergabeprozess folgen sollen.
---

# Projekt-SOP-Fähigkeit (Codex-Seite)

Die Codex-seitige **Ausführungszuordnung** für ein CCSOP-annehmendes Repository. Wie sein Bruder auf der Claude-Seite
(`.claude` Plugin-Skill) zeigt es auf die Regelquelle der Wahrheit und bettet **keinen** Regeltext ein
(Einzelquelle = `docs/methodology/`, um Drift zu vermeiden).

Gestaltungsprinzipien:
1. `docs/methodology/project-delivery-sop.md` ist die **einzelne Quelle** der SOP-Regeln.
2. `docs/records/current.md` ist der Live-Status-Haltepunkt – lesen Sie ihn zuerst und aktualisieren Sie ihn bei Übergaben.
3. Priorisieren Sie, dass die Ausführung nicht zurückgeht.

## Welche Rolle spielt diese Sitzung? (Flussmatrix)

Lesen `.codex-review/config.toml` `[collaboration]` (Regeln: `claude-code-sop-collaboration.md §1.D`):

- `design_owner = "codex"` → **Diese CLI hostet die Fahrsitzung.** Codex besitzt die Klarstellung,
  Design, Aufgabenkarten, Akzeptanzorchestrierung und Abschluss. Die Entwurfsvorprüfung wird durchgeführt von
  das **Gegenstück (Claude)** – über die Review Bridge, wenn es in der MCP-Konfiguration der Codex CLI registriert ist,
  andernfalls vom Benutzer manuell weitergeleitet.
- `implement_owner = "codex"` → **Diese CLI hostet das Implementierungssegment** (§1.D Regel 3): implementieren →
  Selbsttest → Codeüberprüfung (Rezensent = Gegenstück Claude) → Schleife reparieren → bereit zum Testen, dann Bericht
  die §6 strukturierten Ergebnisse + Update `current.md` und geben Sie es an die steuernde CLI zurück.
- Beide Schlüssel fehlen → Legacy-Einzeltreibermodus; Eine Codex-Sitzung fungiert hier nur explizit
  Benutzeranweisung (typischerweise als Gutachter oder vom Gutachter geleiteter Fallback, §1 Modus 3).
- Wechseln Sie niemals den Flow/die Rolle selbst – der Benutzer oder die Konfiguration wählt es aus (§1).

## Ausführungseintrag

1. **Startreihenfolge**: lesen `docs/records/current.md` (Status + aktive Aufgabe + gesperrte Entscheidungen);
   dann das Themendokument für dieses Modul; **Lesen Sie vor der Implementierung/Reparatur die vollständige Aufgabenkarte**
   (`docs/plans/active/…`). Lesen Sie Archive nur, um den Verlauf zu verfolgen. Beim Überprüfen des Codex-Skill-Hosts
   Bereitschaft oder Gerüstherkunft, lesen `references/host-contract.md`; folgern Sie nicht auf sein Minimum
   Version, Roots oder Eintragssatz aus dem Speicher.
2. **Aufgabenkarten**: Split-Flows sind ein echtes Relais – die Implementierungskarte ist der Cross-CLI-Vertrag
   (§1.D Regel 3 / §4.1). Erweitern Sie den Anwendungsbereich nicht; Bei einem Blocker pausieren und melden, anstatt
darum herum improvisieren.
3. **Strukturierte Ausgabe** (§6): Melden Sie bei der Implementierung / Reparatur / Rückgabe „docsRead / sopChecks /“
   filesInScope / filesChanged / testsRun / validationEvidence / handoffUpdated / commit /
   mode/flow/designReview/knownRisks/nextStep`.
4. **Abschlussdisziplin**: Der Abschluss gehört zur **Sitzung des Designeigentümers**. Wenn das so ist
   Sitzung, befolgen Sie SOP §4.2 Abschluss (Dokumentensynchronisierung → Einzelsubjekt-Commit → Kartenarchiv →
   `code-home:` Linie). Wenn dies nicht der Fall ist, stoppen Sie bei „Testbereit“ und geben Sie es zurück.

## Review Bridge (automatische Überprüfung von der Codex-Seite)

Die Überprüfungsbrücke des Repos ist CLI-neutral (stdio MCP). Um die automatische Überprüfung hier zu nutzen, registrieren Sie sich gleich
Server + `--config .codex-review/config.toml` in der MCP-Konfiguration von Codex CLI (`~/.codex/config.toml
[mcp_servers]`). The bridge derives each stage's reviewer from `[Zusammenarbeit]` (§1.D – die
Gegenmodell; Die Korrekturüberprüfung erbt den Prüfer der Sitzung. Ohne die Brücke registriert,
Die Abgabe der Bewertung erfolgt manuell: Der Benutzer leitet weiter prompts/verdicts.

## Regelabschnittskarte

Regeln sind in den SOP-Dokumenten enthalten – nach Themen geordnet, hier nicht duplizieren:

| Thema | Quelle |
|---|---|
| Anforderung → Schiffsfluss / Checklisten / Test-SOP / Abschluss | `docs/methodology/project-delivery-sop.md` |
| Modi / Ablaufmatrix / Rollen / Überprüfungsrahmen 9.A–9.E / Ausgabevertrag | `docs/methodology/claude-code-sop-collaboration.md` |
| End-to-End-Flow + Fehlermodi + Rollback | `docs/methodology/workflow-overview.md` |
| Modellebenen |`docs/methodology/model-tier-strategy.md` |
