# Projektliefer-SOP (wiederverwendbare Vorlage)

> ccsop canonical (Englisch). `/sop-init` materialisiert dies in Ihrem Repo; `/sop-lang`
> rematerialisiert es in einer anderen Sprache. Maschinenstabile Oberflächen (Urteilsenums, `§`
> Anker, die `code-home:` Feldname und seine Werte, Konfigurationsschlüssel, Befehlsnamen).
> wörtlich in der gesamten Übersetzung erhalten.

## 1. Ziel und Umfang

1. Ziel: Anforderung stellen → Umsetzung → test/acceptance → Dokumentation eine einzelne geschlossen
   Schleife, sodass der Kontext nie verloren geht und nie wieder abgeleitet wird.
2. Geltungsbereich: Dieses Projekt und spätere Projekte derselben Form (ersetzen `${STACK}` mit deinem –
   z.B. Backend + Frontend + Datenbank + Cache + ops/deploy).

## 2. Prinzipien

1. Zuerst Vertrag, dann Code: Bestätigen Sie den Verhaltensvertrag und die Akzeptanzkriterien vor der Implementierung.
2. Kleine Schritte: jeweils einen unabhängig überprüfbaren Unterpunkt vorantreiben.
3. Nicht erledigt, bis akzeptiert: „implementiert“ ≠ „erledigt“; Eine Änderung erfolgt erst, nachdem das Testtor bestanden wurde.
4. Dokumente sind der Haltepunkt: Jede wichtige Änderung landet in den Dokumenten, sodass die Arbeit ohne Unterbrechung fortgesetzt werden kann.
5. Analysieren Sie den Sachverhalt: Schlussfolgerungen und Kompromisse werden nur nach Richtigkeit, Leistung und Leistung beurteilt.
   Stabilität, Wartbarkeit, Risiko und cost/benefit – niemals den Vorlieben des Benutzers schmeicheln.
6. Seien Sie ehrlich: Es ist erlaubt (und erwartet), zu dem Schluss zu kommen, dass „dieser Ansatz nicht optimal ist“ oder
   „Das sollte noch einmal gemacht werden“, aber immer mit konkreten Gründen und einer Alternative.

## 3. Standarddokumentstruktur (pro Projekt)

1. `docs/records/current.md` – aktueller Zustand, erledigt, nicht erledigt, wichtige Schnittstellen, nächster Schritt.
2. `docs/records/archive/<period>.md` — historische Zuwächse archiviert von quarter/phase.
3. `docs/methodology/` – Liefer-SOP, Kollaborationsprotokoll, Workflow-Übersicht, Modellebenenstrategie.
4. `docs/plans/active/` und `docs/plans/completed/` — aktive und abgeschlossene Aufgabenkarten.
   - Zur Archivierung fügen Sie a bei `code-home:` Zeile, die den aktuellen Sachstand aufzeichnet. Gesetzliche Werte:
     - `code-home: merged-to-main@<sha>` – mit main zusammengeführt.
     - `code-home: branch=<branch>@<sha>(unmerged)` – auf a feature/trunk Zweig, noch nicht im Hauptzweig.
     - `code-home: deployed@<sha>`– Wird in der Produktion bereitgestellt, nicht unbedingt im Hauptbetrieb.
     - `code-home: doc-only` – Aufgabenkarte betrifft nur Dokumente; Kein Code nach Hause.
     - `code-home: superseded-by@<sha>` — overwritten/replaced durch einen späteren Commit.
     - `code-home: reverted@<sha>` – explizit zurückgesetzt.
   - Dieses Feld erfasst *aktuelle Fakten*; es erzwingt keine Zusammenführung beim Abschluss. Der Punkt ist das
     Monate später können Sie ohne Abweichung antworten: „Wo befindet sich der Code dieser Aufgabe jetzt?“
     den Archivierungsstatus der Aufgabenkarte und den tatsächlichen Bereitstellungsstatus.
5. `docs/design/` — Feature-Designs und Architektur auf Modulebene.
6. `docs/runbooks/` – Umgebungs-, Bereitstellungs-, Ausführungs- und Überprüfungsschritte (Stack-spezifische Hooks finden Sie hier).
7. `docs/references/` – Schemata, generierte Artefakte, statisches Referenzmaterial.

## 4. Anforderung → Schiffsfluss

1. Anforderungsklärung
   - Ausgabe: Umfang, Nichtziele, Datenvertrag, Leistungsziele, Akzeptanzkriterien.
   - Geben Sie die Codierung erst ein, wenn der Vertrag klar ist.
   - **Chunked-Bestätigung (standardmäßig aktiviert, ausgenommen)**: der Designbesitzer der Runde (der Fahrer).
     unter `Driver-led + reviewer gate`, der Rezensent, nachdem er zurückgefallen war `dual closed-loop`)
     Erhebt zunächst nur „Geschäftsziel + Akzeptanzsignal“, damit der Benutzer es bestätigen kann, und füllt es dann aus
     in scope/non-goals/contract/risk. Ziel: Geben Sie dem Benutzer ≥2 unabhängige Verifizierungspunkte
     statt eines großen Blocks + eines einzigen „OK“. Ausnahmen (ein Entwurf kann direkt abgegeben werden):
     1. Der Benutzer hat bereits genügend Ziel + Akzeptanzvertrag angegeben, um den Umfang zu schreiben, ohne zurückzufragen.
     2. Nur-Lese-Aufgaben: Überprüfung, Statusabfragen, log/interface Diagnose, Dokumentenbefragungen, Verlaufsverfolgung – keine Codeänderung;
     3. Die „Ist-es-ein-Defekt“-Triage-Phase eines Fehlers – die fragmentierte Bestätigung erfolgt nach dem Fehler
        Es wurde bestätigt, dass ein tatsächlicher Defekt vorliegt und ein Lösungsansatz erforderlich ist.
     4. Offensichtlich <~30-Minuten-Korrekturen ohne Datenvertrag, ohne neue Schnittstelle, ohne Leistungsziel (inkl. reinem copy/comment/typo).
2. Design
   - Ausgabe: API/SQL/cache/schema/permissions/risk/rollback planen.
   - Benötigt vor dem Codieren die Bestätigung des Benutzers, dass „der Plan ausführbar ist“.
3. Inkrementelle Implementierung
   - Implementieren Sie jeweils einen Unterpunkt. Vermeiden Sie große Änderungen, die schwer rückgängig zu machen sind.
   - Muss nach der Implementierung kompiliert und ausgeführt werden.
4. Selbsttest + Nachweis
- Minimum: Build-Durchgänge + Schlüsselpfadüberprüfung + Protokollnachweis (MUSS ein **inkrementelles Protokoll verwenden
     Fenster** – niemals `tail` das gesamte Protokoll zur Beurteilung; siehe §6.4).
5. Benutzertest
   - Stellen Sie einen „Kopieren und Einfügen ausführbaren“ Testbefehl und Bestehenskriterien bereit.
   – Der Entwickler führt dasselbe Verifizierungsskript zunächst lokal aus und übergibt es dann an den Benutzer.
   - Wenn die Änderung eine Server-Binär-/Frontend-Build-/Skript-abhängige Laufzeit UND die betrifft
     Bei der Verifizierung wird ein *bereits laufender Prozess/bereitgestellter Dienst* wiederverwendet. Bestätigen Sie dies zunächst
     Der Prozess wurde neu gestartet / für den Build dieser Runde erneut bereitgestellt – ansonsten ergibt sich das Ergebnis vom alten
     Prozess sind ungültig (siehe §6.4.6).
   - Aktualisieren Sie das Haltepunktdokument (`docs/records/current.md` + das relevante Themendokument) vor der Übergabe.
6. Getroffene Entscheidung
   - Ein Unterpunkt ist `done` erst nachdem der Benutzer explizit mit „Test bestanden“ geantwortet hat.
   - **Dokument / Methodik / schreibgeschützte Änderungen** (kein ausführbarer „Test“): Fertigsignal = code/design
     Überprüfung bestanden (oder eine explizite Ausnahme) + Benutzer bestätigt Abschluss; Warte nicht auf die Worte
     „Test bestanden“. Siehe §6.2.
7. Dokumentenabschluss
   - Aktualisieren `current.md` (erledigt / nicht erledigt / nächster Schritt). Große Änderungen aktualisieren auch die feature/archive Dokumente.
8. Schließen Sie den Abschluss ab
   - Nach der getroffenen Entscheidung übernehmen Sie „die in dieser Runde akzeptierte Änderung“ selbständig.
   - Schließen Sie dann zuerst die Dokument- und Haltepunktaktualisierungen ab `git commit`.
   - Unaccepted/unrelated/temporary-debug Der Inhalt darf nicht in dieses Commit eingemischt werden, es sei denn, der
     Benutzer fragt ausdrücklich.
9. Parallele Sitzungsisolation
   - Wenn mehrere Sitzungen unterschiedliche Aufgaben vorantreiben, erstellen Sie einen Git-Arbeitsbaum pro
     `claude-code-sop-collaboration.md §4.7` (Geschwister-Container-Pfadmuster).

## 4.1 Regeln für die delegierte Zusammenarbeit (wiederholte Bestätigungen reduzieren)

1. Wenn der Benutzer „gemäß SOP ausführen, nachdem der Plan bestätigt wurde“ sagt, lautet die Standardbedeutung:
   - Der Agent kann die zerstörungsfreie Implementierung, Erstellung, Prüfung, Formatierung und Protokollierung direkt durchführen
     Analyse, gezieltes Löschen des Caches, `git add`, `git commit`;
   - Sobald der Benutzer mit „Test bestanden“ antwortet, übernimmt der Agent die akzeptierte Änderung per „Commit Closeout“.
2. Wenn die Plattform weiterhin eine Autorisierung erfordert, sollte der Agent die **minimale Wiederverwendbarkeit anfordern
   Präfix** (persistent), anstatt erneut per Befehl zu fragen und nicht erneut um mündliche Zustimmung zu bitten
   gleiche Klasse zerstörungsfreier Befehle.
3. „Ausführen gemäß SOP“ umgeht nicht das Plattformberechtigungssystem – es bedeutet, dass der Agent handelt
   standardmäßig und verwendet minimal/persistent Berechtigung für Befehle, die dies erfordern.
4. Folgendes erfordert IMMER eine gesonderte ausdrückliche Bestätigung (niemals automatisch zulässig durch „gemäß der SOP“):
   - Löschen, Überschreiben, Zurücksetzen oder Zurücksetzen nicht wiederherstellbarer Inhalte;
   - zerstörerische Operationen (`rm`, `git reset --hard`, `git checkout --`, …);
   - Produktionskonfiguration oder -dienste ändern;
   - Überschreiben von Datenbankdaten, irreversibel DDL/DML;
   - Bereitstellung/Neustart/Löschung/Massenschreibvorgang in einer Produktionsumgebung.
5. Vorschlagsverfasser erweitern diese Delegation nicht. `codex_implement` / `claude_implement` darf nur
   servervalidierte Patch-Artefakte zurückgeben; Sie gelten niemals für das Aufrufer-Repository. Claude
   Vorschläge sind standardmäßig auf `advisory-only / export-only` bis die Operatorvalidierung konfiguriert ist,
   und flow/tier Befehle aktivieren niemals den Claude-Writer.

## 5. Feature-Checkliste (bei Ausführung ankreuzen)

1. Anforderungsvertrag gesperrt (inkl. Randbedingungen).
2. Designdokument aktualisiert.
3. Implementierung abgeschlossen.
4. **Die zum Owner passende Simplify-Vorprüfung wurde ausgeführt oder begründet ausgenommen**
   (Claude: `/simplify`; Codex: `$simplify`; siehe §5.A). Wird sie ausgelöst, beheben Sie die
   Befunde vor dem nächsten Schritt. Bei einer Ausnahme vermerken Sie den Grund im Selbsttest.
5. Baudurchgänge (z.B. `${BUILD_CMD}`).
6. Schlüsselpfad-Testskript ausführbar.
7. Protokolle beobachtbar (hit/fallback/latency/error-cause).
8. Cache-Szenarien bieten einen **gezielten Cache-Löschbefehl** (`FLUSHALL` ist verboten).
9. Benutzertestbefehl bereitgestellt (Skript bevorzugt).
10. Benutzer bestätigt erledigt (regulär = „Test bestanden“; doc/methodology/read-only gemäß §6.2 = Rezensionspass + Benutzerabschluss).
11. Breakpoint-Dokument aktualisiert.
12. Akzeptierte Änderung, die von sich aus vorgenommen wurde, oder ausdrücklich aufgezeichnet, warum noch nicht.
13. Wenn der Benutzer „gemäß der SOP“ deklarierte, folgte die Autorisierungspräfix-Strategie dem Prinzip der minimalen Wiederverwendbarkeit.

### 5.A `/simplify` oder `$simplify` Vortest-Vorbildschirm (Standard erzwungen)

Nutzen Sie den Skill der implementierenden CLI: Claude Code `/simplify` oder den Repository-lokalen
Codex-Skill `$simplify`. Beide sind kostengünstige lokale Vorprüfungen *vor* dem Reviewer-Gate.
Der Skill prüft Wiederverwendung, Qualität, Effizienz und Abdeckung und behebt anschließend
bestätigte Befunde; den unabhängigen Reviewer ersetzt er nicht.

**Trigger (Maschinenkriterium):**
Die folgenden lesbaren Kriterien werden aus der maschinenlesbaren Wahrheit
`SIMPLIFY_CONTRACT_V1` abgeleitet. Ein Codex-Consumer liest zusätzlich die kanonischen Bytes unter
`.agents/skills/simplify/references/contract.json`; reine Claude-Consumer verwenden diese
Inline-Werte und sind nicht vom Codex-Gerüstpfad abhängig.

- Allowlist für Codepfade: `.go`, `.vue`, `.ts`, `.tsx`, `.js`, `.py`, `.sh`.
- Auslösen, sobald die Summe aus hinzugefügten und entfernten Zeilen des erlaubten Codes im Diff aus committed + staged + unstaged + untracked gegen die Basisreferenz `main` insgesamt `30` erreicht.
- Ausgenommen sind Nicht-Git-Repositories, eine fehlende Basisreferenz `main`, ein detached HEAD, reine Dokumentations-/SOP-/Tippfehleränderungen oder Fälle, in denen der erlaubte Code unterhalb des Schwellenwerts bleibt.

**Ablauf bei Auslösung:** Owner-gerechten Skill aufrufen → bei „keine Befunde“ direkt zum
Selbsttest → andernfalls Befunde im Aufgabenbereich beheben und erneut ausführen, bis keine
offenen Befunde verbleiben oder verbleibende Punkte mit Begründung als nicht anwendbar markiert
sind → Selbsttest → Reviewer-Gate.

**Fallback bei Nichtverfügbarkeit:** Kann der Skill nicht aufgerufen werden, überspringen Sie die
Vorprüfung, vermerken Sie `"simplify skipped: <reason>"` im Selbsttestnachweis und gehen Sie ohne
Blockade zum Reviewer-Gate.

**Beziehung zum Reviewer-Gate:** Vereinfachen ersetzt nicht den Reviewer. Es fängt an
günstig vor Ort reuse/quality/efficiency Probleme; Der Rezensent befasst sich immer noch mit Architektur-/Umfangsabweichungen
/ Querschnittskonsistenz. Orthogonal und seriell (implementieren → vereinfachen → selbst reparieren → selbst testen → überprüfen).

## 6. Test-SOP (einheitliche Entscheidung)

### 6.1 Testschichten

1. Build: macht escompile/package?
2. Schnittstelle: Hauptantworten, Fehlerzweige, Berechtigungszweige.
3. Leistung: Schlüsselpfadlatenz, Cache-Trefferrate, Ursprungsabrufverhalten.
4. Regression: Sind alte Funktionen kaputt?

### 6.2 Bestehenskriterien (alle erforderlich)

1. Das Verhalten stimmt mit dem Plan überein.
2. Keine neuen Blockierungsfehler (P0/P1).
3. Wichtige Protokolle und Kennzahlen entsprechen den Erwartungen.
4. Der Benutzer antwortet explizit mit „Test bestanden“.

**Dokument / Methodik / schreibgeschützte Änderungen** (kein ausführbarer Test): 1–4 gelten nicht; Das Fertigsignal ist
**Bewertungspass (`codex_code_review` / `codex_design_review` Pass / All-fixed oder explizit
Ausnahme) + Benutzerschließung**. Für Änderungen, die sich nur auf das Dokument beziehen, wird immer noch ein Einzelsubjekt-Commit + Dokumentabschluss verwendet.
erfordern aber nicht die Angabe „Prüfung bestanden“.

Unter **`full-auto`** (`claude-code-sop-collaboration.md §1.A`): Die Selbstverifizierung des Fahrers ersetzt
Der „Test bestanden“ des Benutzers **nur** für maschinenüberprüfbare Akzeptanz (build /tests / grep-schema-drift
Invarianten / Spezifikationskonformität). **Subjektive Qualität, reale Umgebung/Produktionsakzeptanz und §4.1
Immer bestätigende Aktionen erfordern weiterhin den Benutzer** (Zusammenarbeit §1.B / §1.C).

### 6.3 Bei Fehler

1. Behalten Sie den fehlgeschlagenen Befehl log + repro bei.
2. Zustand markieren `testing_failed`.
3. Führen Sie nach dem Fix die gleiche Überprüfung erneut durch.

### 6.4 Cache- und Protokollüberprüfungsstandard (Standard erzwungen)

1. **Inkrementelles Protokollfenster**
   - Notieren Sie die Startlinie vor jeder Überprüfung: `N=$(wc -l < ${LOG_PATH})`.
   - Sehen Sie sich nach der Überprüfung nur das Inkrement an: `tail -n "+$((N+1))" ${LOG_PATH}`.
2. **Cache-Treffer-Verifizierung (Methode mit zwei Anfragen)** *(gilt, wenn der Stack über eine Cache-Schicht verfügt)*
   – Die erste Anfrage kann vom Ursprung abgerufen werden. Die zweite Anforderung mit denselben Parametern muss den Cache erreichen.
   – Bei der Annahme muss beides angezeigt werden: Anzahl der Ursprungsabrufe und Anzahl der Cache-Treffer.
3. **Fallback-Pfadüberprüfung (Cache-Interferenz entfernen)**
   - Löschen Sie nur den *Ziel*-Cache key/pattern vor der Überprüfung des Fallbacks (niemals ein globaler Flush).
4. **Skriptbasierte Überprüfung (bevorzugt)**
   - Jeder high-frequency/complex Der Pfad sollte eine haben`scripts/verify_*.sh`das druckt `PASS/FAIL`
     und enthält wichtige Protokollauszüge. Der Entwickler führt es zuerst lokal aus, dann führt der Benutzer den Test erneut durch.
5. **Protokollbeurteilungsbeschränkung**
   - Beurteilen Sie niemals „bestanden“ anhand veralteter historischer Protokolle – verwenden Sie das inkrementelle Protokoll dieser Runde + die aktuelle Antwort.
6. **Konsistenz der Prozessversion (Standard erzwungen)**
   – Wenn die Verifizierung von einem laufenden Dienstprozess abhängt, beginnen Sie nicht mit dem Testen, während der Code ausgeführt wird
     geändert, der Prozess jedoch nicht restarted/redeployed; Bestätigen Sie, dass die Schnittstelle diese Runde ausführt
     erst mal bauen.

> Stack-spezifische Verifizierungs-Hooks (z. B. CRLF-on-Upload-Prüfungen, Übertragungsratenlimits, hostspezifisch
> Bereitstellungseinschränkungen) leben in `docs/runbooks/` als konfigurierbare Haken – siehe §2.3 des Designs und
> der Runbooks-Index. Halten Sie den *erzwungenen* Bereich über bedingungslos; nur stack/env Elemente sind konfigurierbar.

## 7. Backlog-Management-SOP

### 7.1 Staaten
`todo` (nicht gestartet) · `in_progress` (sich entwickelnd) · `testing` (wartet auf Benutzertest) · `done`
(Benutzer bestätigt) · `blocked` (dependency/env) · `cancelled`.

### 7.2 Prioritäten
`P0` (blockiert Hauptfluss / Produktionsausfall) · `P1` (Kernfunktion fehlt oder klares Leistungsproblem) ·
`P2` (UX / Wartbarkeit) · `P3` (langfristige Verbesserung).

### 7.3 Aufnahmevorlage
```text
[ID] [P1] [in_progress] <module>: <one-line item>
- Context: ...
- Contract: ...
- Acceptance: <log keyword + interface behavior + perf target>
- Evidence: <log keyword + interface result>
```

## 8. Regeln zur Dokumentaktualisierung (erzwungen)

1. Alle abgeschlossenen Unterpunktaktualisierungen `current.md`.
2. Zu jeder Hauptfunktion gehört mindestens ein Themendokument (Design oder Validierung).
3. Long/stacked historische Protokolle werden verschoben `archive`; Aktuelle Dokumente bleiben lesbar.
4. „Nicht erledigt“-Elemente in Dokumenten müssen mit dem tatsächlichen Codestatus übereinstimmen.

## 9. Commit- und Release-Regeln

1. Ein Commit, ein Subjekt – keine gemischten Änderungen (Commit für ein einzelnes Subjekt, erzwungen).
2. Vor dem Commit mindestens: Build erfolgreich, Schlüsseltests bestanden, Dokumente synchronisiert.
3. Fügen Sie vor der Veröffentlichung Folgendes hinzu: Konfigurationsprüfung (Umgebung, Berechtigungen, Verbindungsinformationen) + einen Rollback-Pfad.
4. Neue externe Abhängigkeitslegitimität (GSD-Slopcheck-Idee): Vor der Installation einer von der KI empfohlenen oder
   neu eingeführtes Dep eines Drittanbieters, überprüfen Sie es – offizielle Quelle / korrekte Schreibweise (anti
   typo-squat) / aktive Wartung / die Version existiert wirklich; Bestätigen Sie nicht standardmäßige Abweichungen mit dem
   Benutzer, niemals unbeaufsichtigt installieren.

## 10. Breakpoint-Wiederherstellung (bei Kontextverlust)

1. Lesen `docs/records/current.md` zuerst (oder ausführen `/handoff`).
2. Dann das relevante Themendokument (design/validation).
3. Für den Verlauf lesen Sie das Matching `docs/records/archive/<period>.md`.
4. Geben Sie nach der Wiederherstellung „aktueller Status + nächster Schritt“ an, bevor Sie etwas ändern.

## 11. Eingabeaufforderung für wiederverwendbaren Lebenslauf

```text
Continue per the SOP:
1) Module: {...}
2) This sub-item: {one verifiable point}
3) Acceptance: {log keyword + interface behavior + perf target}
4) Rule: mark done only after I reply "test passed"
5) Execute: after plan confirmation, advance per the SOP for non-destructive/low-risk actions,
   requesting minimal persistent authorization
6) Require: keep current.md + the topic doc in sync
```

## 12. Bug SOP (Defekte)

### 12.1 Fluss
1. Triage – Prioritäten `P0`–`P3` gemäß §7.2; `P0` (Produktionsblock) Stop-the-Bleed zuerst, `P1` zuerst reparieren.
2. Repro – Schritte, erwartet, tatsächlich, Explosionsradius; Beweise einfrieren (log/SQL/response/screenshot, ≥1).
3. Stoppen Sie die Blutung (P0/P1) — toggle/degrade/rollback/throttle um die Verfügbarkeit mit minimalem Risiko wiederherzustellen.
4. Grundursache – „direkte Ursache + Auslöser + warum nicht schon früher aufgedeckt“.
5. Fix – minimale geschlossene Änderung; Vermeiden Sie große Refaktoren innerhalb einer Fehlerbehebung.
6. Verifizieren + Regress – Fehlerpfad wird erneut durchlaufen; verwandte Pfade werden sauber zurückgeführt.
7. Fertig – `done` erst nachdem der Benutzer mit „Test bestanden“ geantwortet hat.
8. Dokumentabschluss – Aktualisierung `current.md`: Symptom, Grundursache, Fehlerbehebung, Befehl überprüfen, Status.
9. Überprüfung einfrieren – Falten Sie die Überprüfung des Fehlers script/command in die SOP oder das Feature integrieren
   Validierungsdokument als Standard für ähnliche Probleme verwenden.

### 12.2 Fehlerzustände
`todo` · `in_progress` · `mitigated` (P0/P1 nur) · `testing` · `done` · `reopened`.

### 12.3 Defektkartenvorlage
```text
[BUG-ID] [P1] [in_progress] {module}
- Symptom / Repro / Expected / Actual / Blast radius / Evidence
- Root cause / Mitigation / Fix / Verify command / Pass criteria / State
```

## 13. Spike SOP (Machbarkeitsexperimente)

Wann approach/contract/performance ist unbekannt und Sie müssen ein Experiment durchführen, bevor Sie eine auswählen
Richtung, führen Sie einen Spike aus, anstatt ihn als Gerät vorzuschieben. Ziel: separates „Trial-and-Error“
von „Lieferung“, damit der Sondencode nicht in die Datei gelangt main/production Pfad.

### 13.1 Wenn es eine Spitze ist
1. Machbarkeit / Leistungsobergrenze / Datenvertrag unbekannt – beweisen Sie zunächst, ob es sich lohnt.
2. A/B Vergleich, Halbierung, Profilierung – vorübergehende Experimente, die nur einer Schlussfolgerung dienen.
3. Ansatz bereits festgelegt, nur die Implementierung schreiben → **keine** Spitze; normaler Fluss.

### 13.2 Sondencode-Platzierung (erzwungen)
1. Bevorzugen Sie **einzelne Einwegskripte** (`scripts/spike_*`, `scripts/probe_*`); nicht untermischen main/production Code.
2. Wenn der Hauptcode berührt werden muss: Isolieren Sie ihn mit einem expliziten Umschalter (Standardeinstellung aus) UND registrieren Sie ihn
   „Vorübergehender Sondenwechsel + Reinigungsverpflichtung“ in der Übergabe- oder Aufgabenkarte.
3. Einseitige Abhängigkeit: Der Hauptcode darf keine Probe-Skripte importieren.

### 13.3 Urteil (drei Staaten)
Beenden Sie jede Spitze mit einer Zeile: `VALIDATED / INVALIDATED / PARTIAL` + einzeiliger Beweis + data/log
Anker (Zeilennummer, Commit, Tabelle, Latenznummer). Noch nie „ausprobiert, fühlte sich gut an“.

### 13.4 Bereinigung/Konsolidierung (erzwungen, wählen Sie eine aus)
1. **Löschen** – Wegwerfcode entfernen; Wenn der Hauptcode berührt wurde, reinigen Sie ihn vor der Schließung (siehe §14).
2. **Konsolidieren** – dauerhaften Wert fördern `scripts/verify_*.sh` oder ein baseline/degraded umschalten
   (Behalten Sie den alten Pfad als Fallback + bei A/B, nicht überschreiben).
Das Urteil selbst (Urteil + Beweise + Kompromiss) landet im Abschnitt oder in den Aufzeichnungen des Implementierungsdatensatzes des Entwurfs.

## 14. Selbstprüfung der Closeout-Integrität (GSD-Forensik)

§5 prüft *vor dem Test* „Habe ich die Arbeit dieser Runde erledigt“; §14 ist eine forensische Nachprüfung *bei Abschluss* –
„Haben sich Zustandsdrift/Reste eingeschlichen?“ Führen Sie es vor der Schließung manuell aus:

1. `current.md` „Nicht erledigt / Nächster Schritt“ entspricht dem tatsächlichen Codestatus – kein falsch eingestellter Status, keine veralteten erledigten Elemente.
2. `git status` sauber – keine verbleibenden, nicht festgeschriebenen Änderungen, kein aufgegebenes Diff, keine temporäre Debug-Ausgabe (`console.log` / `print` /temporäre Protokolle).
3. Sonden-/Diagnosepflaster gereinigt (gemäß §13.2 Registrierung); Im Hauptcode gibt es keine bloßen Temperaturumschaltungen.
4. Kein unausgegorener Commit oder verwaister Branch von einem abort/interrupt.
5. Archivierte Aufgabenkarten `code-home:` Linien sind real und überprüfbar (gegenüber dem Tatsächlichen). commit/branch/deploy).
6. Neue Deps (falls vorhanden), überprüft gemäß §9.4.
