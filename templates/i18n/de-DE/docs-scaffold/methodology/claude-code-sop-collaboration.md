# Kollaborationsprotokoll (Treiber + Prüfer)

> ccsop canonical (Englisch). Passt zu `project-delivery-sop.md` und `workflow-overview.md`.
> Der „Fahrer“ ist der Agent, der Eigentümer der Fahrsitzung ist (siehe §1.D – seine CLI gehört dem Designer
> CLI); Der „Rezensent“ jeder Stufe ist das **Gegenstückmodell des Eigentümers dieser Stufe** (abgeleitet –
> siehe §1.D), übermittelt über die Review Bridge oder manuell gemäß §1. Dieses Protokoll generischt a
> kampferprobter Workflow; Es behält die Regeln bei und tauscht nur Projektanker aus `${...}`.

## 1. Modi

Drei Kollaborationsmodi; Die ersten beiden sind **treibergeführt** (die Standardform) und unterscheiden sich nur darin
Wie die Bewertung abgegeben wird, der dritte ist ein **vom Rezensenten geleiteter** Fallback:

1. **`driver-led + reviewer gate` (Standard).** Der Fahrer übernimmt die Klärung, das Design und die Aufgabe
   Karten, implementieren, reparieren, schließen. Der Prüfer führt eine **Codeüberprüfung** (und eine Design-Vorüberprüfung) durch
   wenn §4.5 auslöst). Wann `review.provider = manual`, Bewertungsmitteilung wird weitergeleitet von
   Der Benutzer (der Fahrer schreibt eine Eingabeaufforderung, a human/external (Rezensent gibt ein Urteil ab).
2. **`driver-led + auto review`.** Wann `review.provider ∈ {codex, claude}` und die Rezension MCP
   Bridge ist verkabelt, ruft der Treiber auf `codex_design_review` / `codex_code_review` /
   `codex_fix_review` automatisch an den Knoten §4.5 / implementieren / reparieren – keine manuelle Weiterleitung.
   Der Fahrer führt das Urteil dann mechanisch aus (siehe §3 Urteilsmatrix). Der Benutzer ist nur
   unterbrochen durch einen Leistungsschalter oder `No-Go`.
3. **`reviewer-led closed loop` (Fallback, standardmäßig ruhend).** Rollen werden umgekehrt: Der Prüfer besitzt
   Entwurf, Aufgabenkarten, Überprüfung, Abnahme und ggf. Durchführung des Abschlusses; Der Treiber implementiert Code +
   testet Skripte und gibt strukturierte Ergebnisse zurück (§6). Die Kommunikation wird vom Benutzer oder einem weitergeleitet
   Projektspezifische Automatisierung (die Automatisierung selbst ist **nicht** Teil von ccsop – stellen Sie Ihre eigene bereit
   wenn Sie dies vollautomatisch wünschen). Verwenden Sie dies, wenn Sie das möchten stronger/independent Modell zu besitzen
   Design und Akzeptanz und der Treiber, ein reiner Umsetzer zu sein. Siehe §8.1 für seine Schleife.

Alle Modi gehorchen `project-delivery-sop.md` und muss die vollständige Schleife schließen
(Design → Implementieren → Testen → Überprüfen → Reparieren → Abschluss); Nur ein mittleres Segment zu machen, ist nicht „fertig“.
**Modus – und der §1.D-Ablauf – werden explizit** vom Benutzer ausgewählt (ein expliziter Schalter).
Anleitung) oder Projektkonfiguration; Weder der Fahrer noch der Prüfer wechseln den Modus oder den Ablauf selbstständig.
Um zur automatischen Überprüfung zu wechseln, muss die Bridge ihren Selbsttest bestehen (`verify-mcp`); auf
bridge/provider Die automatische Fehlerüberprüfung wird auf Modus 1 herabgestuft und nicht automatisch wiederhergestellt.

## 1.Ein Autonomie-Regler (orthogonal zu den Modi)

Eine dritte Achse in den **fahrergeführten** Modi (die Rollen werden nicht geändert, es handelt sich also nicht um einen vierten Modus):
- **`gated` (Standard)** – der Benutzer bestätigt das Design (§4 Chunk-Bestätigung), gibt „Test bestanden“ aus
  (`project-delivery-sop.md §6.2`) und bestätigt jeden §4.6-Zusammenführungspunkt.
- **`full-auto`** – Der Fahrer bewegt sich automatisch zu den **Routine**-Gates: Entwurfsfreigabe über den selbstgeprüften §4
  Vertrag + die §3-Auto-Review-Schleife; Akzeptanz durch Selbstverifizierung **sofern legitim** (§1.C); lokal
  Restposten + ein Einheimischer `git merge --ff-only` zu main (§4.2/§4.6). Der Lauf endet mit einem **Laufbericht** (§6.A). Die
  Treiber **unterbricht die Schleife und übergibt die Kontrolle nur dann an den Benutzer, wenn das Eskalationsprädikat (§1.B) ausgelöst wird.**

Setzen Sie es ein `.codex-review/config.toml` `[collaboration] autonomy = "gated" | "full-auto"` (Betriebsschlüssel; der
Review Bridge ignoriert es; a missing/invalid Wert ist **Fail-Closed to `gated`**). Eine explizite Benutzeranweisung
(„full-auto“ / „一杆推到底“ / „gated this one“) überschreibt pro Sitzung. full-auto **nie** lockert die §1.B-Nie-Auto-Klassen.

## 1.B Eskalationsprädikat (vollautomatische Stopps und Übergabe an den Benutzer, wenn)

Vollautomatisch läuft unbeaufsichtigt **außer**, wenn einer dieser Punkte gilt – dann stoppt es, meldet und empfiehlt ≥1 Option:
1. **Immer bestätigen (`project-delivery-sop.md §4.1`)** – destruktiver/irreversibler Betrieb, Produktionskonfiguration oder
   Dienständerung, irreversibel DDL/DML, bereitstellen / neu starten / löschen. (niemals automatisch)
2. **Exfil-Klasse** – Senden privater Inhalte an einen externen Dienst (z. B. einen privaten→öffentlichen Push). (niemals automatisch)
3. **Remote-Externalisierung (§4.6)** – Pushen auf einen Remote-Zweig, Löschen eines Remote-Zweigs, Veröffentlichen/Freigeben
   (Lokale Schließung + lokale Nur-FF-Zusammenführung mit Main ist automatisch; **alle Remote-Aktionen** eskalieren). (niemals automatisch)
4. **Geschmacks-/Domänen-/Akzeptanzurteil, das nur der Benutzer fällen kann** – subjektive Qualität (Prosa / Übersetzung /
   UX), reale Umgebung oder Produktionsakzeptanz, geschäftliche Prioritätsaufrufe, „Ist das akzeptabel?“-Gates.
5. **Unlösbare Mehrdeutigkeit** – scope/requirement wirklich unterbestimmt und nicht aus dem Kontext lösbar,
   die Codebasis oder der Prüfer. (Eine Entscheidung, die durch eine vernünftige Vorgabe oder durch den Prüfer gelöst werden kann, ist **keine** Entscheidung
   Eskalation – entscheiden, aufzeichnen, fortfahren.)
6. **Stall (§9.E)** – die Fixschleife konvergiert nicht (gleicher kritischer Wert für 2 Runden / kritischer Gesamtwert flach für 2 Runden /
   Regressions-Ping-Pong) → Eskalation mit ≥2 Optionen.
7. **Rezension`No-Go`/breaker** – Entwurfs- oder Codeüberprüfung `No-Go`oder ein Schutzschalter hat ausgelöst.
8. **Technischer Fork → Reviewer zuerst** – ein *technischer* Design-Fork ohne klare Vorgabe geht an
   `codex_design_review` (nicht der Benutzer); nur ein *preference/business* Fork geht an den Benutzer.
9. **Ausführungsblocker** – fehlt credential/key, Verweigerung der Plattformberechtigung, Sandbox/Netzwerk/Abhängigkeit
   Einschränkung, ein erforderliches Tool ist nicht verfügbar oder eine **erforderliche Überprüfung, die tatsächlich nicht ausgeführt werden kann**. Eskalieren
   mit dem fehlgeschlagenen Befehl + Beweis; **Verifizieren Sie niemals eine Prüfung selbst, die nicht ausgeführt wurde.**

## 1.C Selbstverifizierungsgrenze + früher Probenkontrollpunkt

- **Selbstverifizierung KANN die Angabe „Test bestanden“ des Benutzers nur dann ersetzen, wenn die Akzeptanz **maschinenüberprüfbar** ist:
  build/compile, automatisierte Tests, grep/schema/drift-gate Invarianten, Spezifikationskonformität mit dem Design.
- **Selbstverifizierung darf NICHT ersetzen** (→ Eskalation gemäß §1.B.4/§1.B.9) für subjektive Qualität, reale Umgebung /
  Produktionsabnahme oder alles, was einer externen Beobachtung bedarf oder domain/business Urteil.
- **Früher Probenkontrollpunkt (anti „effizient falsch“):** für **taste/style-heavy** oder **Großserie**
  Ergebnisse: Vollautomatisch erstellt eine kleine **repräsentative Stichprobe** und überprüft diese **vorher** beim Benutzer.
  Massenproduktion – erzeugen Sie nicht die gesamte Charge auf unbestätigte Weise style/contract.

## 1.D Flussmatrix (wer entwirft × wer implementiert – orthogonal zu §1 Modi und §1.A)

Eine vierte Achse. Der „Fahrer“ zerfällt in zwei **Bühnenbesitzer** – `design_owner` und
`implement_owner`, jeweils `claude` oder `codex` — ergibt **4 umschaltbare Flüsse** (benannt
`<design_owner>+<implement_owner>`):

| fließen | Design | Designbewertung | implementieren | Codeüberprüfung | Fahren von CLI |
|---|---|---|---|---|---|
| `claude+claude` (Standard) | Claude | Codex | Claude | Codex | Claude Code |
| `claude+codex` | Claude | Codex | Codex | Claude | Claude Code |
| `codex+codex` | Codex | Claude | Codex | Claude | Codex |
| `codex+claude` | Codex | Claude | Claude | Codex | Codex |

Regeln:
1. **Prüfer werden abgeleitet, nie konfiguriert**: Der Prüfer einer Phase ist immer das **Gegenstück
   Modell des Eigentümers dieser Stufe** (Designüberprüfung ← Gegenstück(design_owner); Codeüberprüfung ←
   Gegenstück(implement_owner); Die Korrekturüberprüfung wird von dem Prüfer, der die Ergebnisse vorgebracht hat, erneut beurteilt.
Selbstbewertung ist daher *nicht darstellbar*, nicht nur verboten.
2. **Die Fahrsitzung befindet sich in der CLI des design_owners** („von welchem Modelldesign Sie auch immer fahren).
   seine CLI"). Der Designer (Fahrer) ist für die Klärung, das Design, die Aufgabenkarten, die Akzeptanzorchestrierung usw. zuständig.
   und Restposten; Der Implementierer besitzt Implement + Selbsttest + Fix und gibt §6 strukturierte Ergebnisse zurück.
   Wenn die Besitzer übereinstimmen, ist dies genau das Verhalten einzelner Fahrer, das an anderer Stelle in diesem Dokument beschrieben wird
   Protokoll.
3. **Split-Flows** (`design_owner ≠ implement_owner`) sind ein echtes Relais: Eine **Implementierungs-Aufgabenkarte ist
   obligatorisch** (§4.1 – ein geteilter Fluss ist per Definition N≥2). Das Gerätesegment – Gerät →
   Selbsttest → Codeüberprüfung → Schleife reparieren → bereit zum Testen – läuft **vollständig in der CLI des Implementierers
   Sitzung**; Die Rückgabe an die Fahr-CLI erfolgt über die §6 strukturierten Ergebnisse + die `current.md`
   Haltepunkt. Codex `$handoff` und Claude `/handoff` Beide haben diesen Live-Haltepunkt noch einmal gelesen. Der Benutzer
   trägt den CLI-Schalter (kein Automatisierungskabel ist Teil von ccsop) – außer den beiden unabhängig voneinander
   Gated Proposal Adapters in den Regeln 3.A und 3.B unten.

3.A **Preside-Modus (`claude+codex` nur): „Claude präsidiert + Codex schreibt“ – kein CLI-Schalter.**
   In dieser Zelle ist der Code-Reviewer = Gegenstück(Codex) = Claude = die Fahrsitzung selbst, also
   Die gesamte Schleife kann innerhalb einer Claude-Sitzung ablaufen: Der Fahrer entwirft, schreibt die Gerätekarte
   (noch zwingend erforderlich – es handelt sich um den Versandvertrag, §4.1; dessen ``Der Dateiblock ist der maschinell analysierte Block
   Zulassungsliste schreiben) und sendet dann begrenzte Arbeitsaufträge über das Bridge-Tool an einen Codex-Autor
   **`codex_implement`** (konfig `[implement] enabled=true`, eingestellt von `/sop-init` nur dafür
   exakter Durchfluss; standardmäßig ausgeschaltet). Das Tool schreibt NIEMALS in das Repository: Codex arbeitet isoliert
   Kratzer; Der Server validiert das Ergebnis (jedes Endzustandsdelta außerhalb der Zulassungsliste ⇒ abgelehnt, nein
   Artefakt) und gibt ein **Patch-Artefakt** unter zurück `.codex-review/dispatches/`. Der Fahrer also
   **überprüft den Patch gemäß §9 direkt** (modellübergreifend – der Implementierer ist Codex; keine Bridge-Überprüfung
   Anruf, keine Selbstüberprüfung) und **wendet es selbst an**: `git apply --check` → `git apply`. Runden reparieren
   sind neue Sendungen mit den vom Fahrer bewerteten Erkenntnissen. Das Urteilsvermögen verlässt nie den Fahrer; nichts
   automatisch anwenden; Es gibt keine automatische Korrekturschleife.
3.B **Optionaler Vorschlagsmodus (`codex+claude` nur): „Codex präsidiert + Claude schreibt“.**
   Schema 2 stellt dar `claude_implement` erst wenn der Bediener dies selbständig freigegeben hat
   abgeschlossen `[implement.claude]` Abschnitt. Der Server überprüft die aktive Karte path/SHA und genau
   Allowlist und führt dann die zertifizierte Claude-CLI innerhalb von Linux Bubblewrap mit aus Read/Edit/Write nur
   (kein Bash), Ersatzumgebung, schreibgeschützte OAuth-Anmeldeinformationen, process/resource Grenzen, langlebig
   per-design/daily Budgets und caller/config/credential Integritätsprüfungen. Capture-Feeds sind das Gleiche
   Anbieterneutrale Patch-Transaktion als `codex_implement`. Die Servervalidierung wird vom Betreiber durchgeführt
   argv-Arrays offline gegen wiederhergestellte Definitionsvorbilder. PASS kann produzieren `applicable`;
   unconfigured/failed/definition-affecting Validierung erzeugt `advisory-only`, was ist
   Nur für den Export, es sei denn, der Betreiber hat sich gesondert für die Anwendung der Empfehlung entschieden. Nichts wird automatisch angewendet.
4. **Konfiguration**: `.codex-review/config.toml` `[collaboration] design_owner / implement_owner`
   (betriebsbereit + von der Überprüfungsbrücke zur Ableitung des Prüfers gelesen). **Schlüsselpräsenz ist wichtig**:
   Wenn **beide Schlüssel fehlen**, bleibt die Bridge im **Legacy-Modus** – dem globalen `review.provider`
   regelt jede Phase genau so, wie bevor diese Achse existierte. Mit **jedem vorhandenen Schlüssel** erfolgt die Ableitung
   aktiv (ein fehlender Gegenschlüssel wird behoben `claude`). Ungültige Werte fallen laut aus (Brücke beeinträchtigt),
   niemals stillschweigend zurückfallen. Eine explizite Benutzeranweisung („dieser Codex+Claude“) überschreibt pro
   Sitzung, gleiche Konvention wie §1.A. Verwendung von Claude-gesteuerten Flüssen `/sop-flow`; Verwendung von Codex-gesteuerten Flüssen
   `$sop-flow`. Beide nennen dasselbe `ccsop_configure` Vertrag und die nächste öffentliche Brücke
   Der Aufruf beobachtet die Änderung ohne Neuladen. Schema 1 bleibt erhalten `codex+claude` als Handrelais;
   Schema 2 koppelt die vollständig deaktivierte Konfiguration, das echte Tool, den Sandbox-Runner, die Validierung und
   Bereitschaft UX. Die Flussauswahl aktiviert niemals den schreibfähigen Adapter.
5. `review.provider = manual` Erzwingt weiterhin die **manuelle Zustellung** für jede Phase – die Abläufe bleiben bestehen
gültig; Der Benutzer leitet jede Stufe weiter prompt/verdict von Hand an das Gegenmodell angepasst.
6. Der **vom Gutachter geleitete Fallback (§1 Modus 3)** ist, in Matrixbegriffen, ungefähr der `codex+claude`
   Flow unter manueller Bereitstellung – es ist älter als diese Achse und wird als dokumentierter Legacy-Alias ​​behalten.

## 2. Rollen

1. **Treiber** – Klärung + Brainstorming (SOP §4 Chunked-Confirmation-Kadenz); Design,
   Aufgabenkarten, Akzeptanzkriterien; Implementierung, Testskripte, Verifizierungsbefehle; läuft die
   eigentümergerecht `/simplify` oder `$simplify` Vorprüfung (SOP §5.A); Führt einen Selbsttest durch und erstellt Berichte
   strukturierte Ergebnisse (§6 Felder);
   wendet Überprüfungskorrekturen an; Führt den Abschluss durch, nachdem der „Test des Benutzers bestanden“ wurde (Einzelsubjekt-Commit).
   + Übergabeabschluss + Aufgabenkartenarchiv + `code-home:` Linie). Auf einem Blocker (Ratenlimit /
   Erlaubnis / Umgebung / unklarer Vertrag) pausiert und meldet – es erweitert nicht stillschweigend den Umfang.
2. **Reviewer** – schaut sich den echten Repo-Diff / die Aufgabenkarte / den Testbeweis / den Übergabestatus an und führt ihn aus
   §9 (9.A/9.B/9.C/9.D); Führt eine Vorabprüfung des Designs durch, wenn Sie dazu aufgefordert werden oder wenn §4.5 ausgelöst wird. Nicht
   Anforderungen klären, implementieren, Tests schreiben oder abschließen. Im automatischen Modus läuft es schreibgeschützt,
   Genehmigung = nie, kein Netzwerk, keine Websuche und gibt das strikte Umschlagschema + 9 aus
   `verdict_factors` + Prädikat (siehe Brückendesign).
3. **Benutzer** – führt Überprüfungsskripts aus; gibt das Signal „Test bestanden“; bestätigt ausdrücklich alles
   destruktive/einflussreiche Aktionen (Merge to Main, Push, Branch-Löschung); im manuellen Modus,
   Leitet die Kommunikation zwischen Fahrer und Prüfer weiter.

Die oben genannten Rollen beschreiben die vom Fahrer geführten Modi (§1 Modi 1–2) mit übereinstimmenden Bühnenbesitzern (§1.D
`claude+claude` / `codex+codex`). In einem **Split Flow** (§1.D Regel 3) teilt sich die Fahrerrolle entlang der
Bühnengrenze: Der Designer-Fahrer behält Klärung / Design / Karten / Annahme / Abschluss,
während die Implementierungs-, Selbsttest- und Korrekturaufgaben an den Implementierer (Gegenstück-CLI) übertragen werden, der
meldet sich über §6 zurück. Im **Rezensenten-geführten Fallback** (§1 Modus 3 / §8.1) vertauschen sich die Rollen: die
Der Prüfer besitzt Entwurf/Aufgabenkarten/Abnahme/Abschluss und der Fahrer ist ein reiner Implementierer
(nur Code + Testskripte).

Unter dem **Autonomie-Zifferblatt** (§1.A): in `full-auto` die Pflicht des Nutzers, „destruktive/einflussreiche Handlungen zu bestätigen“.
(§1.B.1–3) ist **unverändert**; Bei der vollautomatischen automatischen Weiterentwicklung handelt es sich lediglich um die *routinemäßige* Designfreigabe/„Test bestanden“.
/ Local-Merge-Gates (gemäß §1.B / §1.C).

## 3. Urteilsmatrix zur automatischen Überprüfung

Im Automatikmodus führt der Fahrer das Hüllkurvenurteil mechanisch aus – es erfolgt keine Neuinterpretation
Prosa (wenn Prosa und Urteil nicht übereinstimmen, gewinnt **das Urteil**):

- `Go` / `Pass` → Fahren Sie mit der nächsten Stufe fort.
- `Go-after-fixes` / `Pass-after-fixes` → die mechanischen Reparaturen anwenden; **nicht** erneut ausführen
  design/code Rezension; fortfahren.
- `Rereview-after-fixes` → Nach der Korrektur kehren Sie zur entsprechenden Überprüfungsphase zurück (Ausführen `codex_fix_review`).
- `No-Go` → anhalten und dem Benutzer Bericht erstatten.

Der Treiber wechselt automatisch in den Zustand „Testbereit“. nur ein Leistungsschalter (max. Patronen / Zielfernrohrdrift /
Kontext erschöpft / Prüfer nicht verfügbar / Parser nicht verfügbar) oder `No-Go` ruft den Benutzer zurück.
Auf bridge/provider Bei einem Fehler **verringert sich der Treiber auf manuelle Weiterleitung** und sagt dies ausdrücklich;
Es erfolgt nie eine automatische Wiederherstellung – der Benutzer muss den automatischen Modus erneut aktivieren.

## 4. Pflichteingaben

Bevor er handelt, liest der Fahrer den Kontext:
1. `docs/methodology/project-delivery-sop.md`
2. `docs/records/current.md`
3. Das Themendokument für dieses Modul
4. Die Aufgabenkarte dieser Runde

**Bevorzugen Sie beim Sitzungsstart / beim Wechseln der aktiven Aufgabe den Aufruf `/handoff`** statt
Lesen Sie alle vier vollständig (spart etwa 70 % Starttoken). `/handoff` extrahiert das minimale Quality-Gate
Abschnitte (Ziel / Nicht-Ziele / Akzeptanz / Überprüfungsstatus / gesperrte Entscheidungen / Zusammenarbeit
Grenze / nächster Schritt) ab `current.md` + die aktive Aufgabenkarte. **Vor der Eingabe von „Implementieren/Fixieren“.
Sie MÜSSEN trotzdem die vollständige Aufgabenkarte lesen** (Übergabe ist keine Grundwahrheit); Lesen Sie den SOP-Volltext und die
Modulentwurfsdokument abschnittsweise auf Anfrage während der Implementierung, nicht präventiv.

## 4.1 Aufgabenkartenkonvention (Karten entwerfen vs. implementieren)

Entscheiden Sie, ob für diese Runde eine neue Aufgabenkarte „Implementieren“ erforderlich ist, indem Sie feststellen, ob sich der Umfang des Entwurfs aufteilt
in **mehrere unabhängige Implementierungsphasen** (jede mit ihrem eigenen Abschluss +). `code-home:`):

| Fall | Handhabung |
|---|---|
| **N=1** Einzelrundengerät | **Keine Gerätekarte.** Falten Sie die Restpostenzusammenfassung in den Abschnitt „Umsetzungsdatensatz“ des Entwurfs. Das Designdokument ist der runde Vertrag. |
| **N≥2** mehrphasig (jede Phase unabhängiger Abschluss / unterschiedliche Schiffsfrequenz) | **Eine Gerätekarte pro Phase** `<design-id>-<phase>-implement.txt` von `docs/plans/_template-implement.txt`; jeweils archiviert nach `docs/plans/completed/<module>/`. |
| **N=1, aber mitten in der Runde pausiert/abgegeben** | Erstellen Sie die Gerätekarte, nachdem die erste Phase abgeschlossen ist. |
| **Geteilter Fluss (§1.D, `design_owner ≠ implement_owner`)** | **Implementierungskarte immer erforderlich** (N≥2 per Definition – die Karte ist der Cross-CLI-Relay-Vertrag). |

Begründung: In Einzelrundenfällen ist eine Gerätekarte überflüssig (alles passt in das Design).
doc); In Fällen mit mehreren Runden besteht das Designdokument aus dem dauerhaften, rundenübergreifenden Dokument und den Karten pro Phase
Verhindern Sie, dass es aufbläht, und lassen Sie es `code-home:` pro Phase eingehalten werden.

## 4.2 Phasenweise Ausführung

- **`plan`** – nur Vertragsbestätigung, Umsetzungsplan, Risiko + Abnahme. Keine Codeänderungen,
  kein Commit. Erklären `scope / nonGoals / filesInScope / nextStep`. Der Designinhaber erhöht
  „Geschäftsziel + Akzeptanzsignal“ zuerst (SOP §4 Chunked-Bestätigung), mit den gleichen Ausnahmen.
- **`implement`** – Implementierung eines akzeptablen Unterpunkts; Führen Sie einen minimalen Selbsttest durch. Übergabe + Thema aktualisieren
  Dok. Nein `git add/commit/push` Außenposten. Ausgabe `testsRun / validationEvidence / handoffUpdated`.
- **`fix`** – nur die Feststellungen des Prüfers korrigieren; den Anwendungsbereich nicht erweitern. Die `summary` konzentriert sich auf „was behoben wurde“.
- **`closeout`** – erst nachdem der Benutzer mit „Test bestanden“ geantwortet hat; vom Fahrer durchgeführt. Schritte (in der Reihenfolge):
  1. Aktualisierung `docs/records/current.md` (Aufgabe von „In Bearbeitung“ auf „Erledigt“ verschieben; bei Bedarf eine Statuskarte hinzufügen);
  2. Aktualisieren Sie das Themendokument (Design/Runbook/Übergabe);
  3. Hängen Sie die an `code-home:` Zeile zur Aufgabenkarte (SOP §3.4 Werte; `branch=<branch>@<sha>(unmerged)` falls noch nicht zusammengelegt);
  4. Ziehen Sie die Karte ab `docs/plans/active/` zu `docs/plans/completed/<module>/`;
  5. Konventionelles Ein-Subjekt-Commit (`feat(<module>): …` / `fix(…)` / `docs(…)`), nur die in dieser Runde akzeptierte Änderung.

  `git push` / `git merge main` werden hier standardmäßig **nicht** durchgeführt – siehe §4.6.

  Unter **`full-auto` (§1.A)**: Der Treiber kann Closeout ** + einen lokalen ausführen `git merge --ff-only` zu main** ohne
  Stoppen, **nur nach** dem Closeout-Commit + Selbstverifizierung (§1.C) und **Fail-Fast** (Pause + Bericht), wenn
  ff-only schlägt fehl. **Remote** push/merge immer noch eskalieren (§1.B.3 / §4.6).

### 4.5 Auslöserliste für die Vorüberprüfung des Designs

Der Treiber fordert standardmäßig **keine** Entwurfsvorprüfung an; es **muss**, wenn einer dieser Punkte zutrifft
(Holen Sie sich das Urteil zurück, bevor Sie es umsetzen):
1. new/changed externe Schnittstelle (HTTP-API/Handlersignatur/öffentlicher Funktionsvertrag);
2. new/changed Datenspeicherschema oder Cache-Schlüssel naming/invalidation Regeln;
3. new/changed Berechtigungsmodell (RBAC/Authentifizierungskette);
4. new/changed Bereitstellungspfad oder geplanter Job (Diensteinheit/Cron/Hintergrund-Worker/Warteschlange);
5. P0/P1 Fehlerbehebung (beeinflusst Produktionsverfügbarkeit/Hauptfluss);
6. Ebenenübergreifende Änderung (Frontend- und Backend-Vertragsänderung zusammen);
7. ML / Staged-Pipeline-Grenze, Trainingsdatenvertrag oder Modellsignaturänderung;
8. produktionssichtbare Verhaltensänderung (vom Benutzer wahrnehmbare Logik);
9. irreversibler Datenbetrieb (DDL/Massen-DML/Datenmigration);
10. veranschlagt > einen halben Tag, oder die Änderung erstreckt sich eindeutig über mehr als ein Modul.

**Wenn Sie sich nicht sicher sind, verwenden Sie standardmäßig die Vorprüfung.** Geben Sie das Urteil der Vorprüfung im Designdokument oder in der Aufgabe ab
Abschnitt „Entwurfsentscheidungen“ der Karte. Die `designReview` Feld (§6) ist `done` / `skipped` / `required`.

### 4.6 Funktion → Haupt-Merge-Kadenz

Sobald main kanonisch ist, führen Sie jedes Feature kurz nach dem Abschluss zusammen (keine Stapelverarbeitung). Der Fluss hat **4
unabhängige Benutzerbestätigungspunkte**; Der Fahrer meldet sich bei jedem und wartet auf explizites
Vor dem nächsten loslegen – niemals Schritte bündeln:
1. Der Treiber schließt den Abschluss-Commit für den Feature-Zweig ab.
2. **Bestätigen #1 (Push-Funktion):** Fahrer fragt; Benutzer genehmigt → `git push origin <feature-branch>`.
3. **Bestätigen #2 (Hauptzusammenführung):** Benutzer genehmigt → `git checkout main && git merge --ff-only <feature-branch>`.
   Wenn „FF-only“ fehlschlägt (Haupt- und Feature-Version divergieren), pausieren und melden – tun Sie es nicht rebase/no-ff auf eigene Faust.
4. **Bestätigen #3 (Push Main):** Benutzer genehmigt → `git push origin main`.
5. **Bestätigen Sie #4 (Remote-Feature-Zweig löschen):** Benutzer genehmigt → `git push origin --delete <feature-branch>`.
6. Aktualisieren Sie die Aufgabenkarten `code-home:` von `branch=…(unmerged)` zu `merged-to-main@<sha>` als separates Dokument-Commit.

Diese Bestätigungspunkte werden durch „Ausführen gemäß SOP“ nicht automatisch zugelassen; Ein „Mach weiter“ geht nicht
Autorisieren Sie eine Kette von Remote-Git-Aktionen.

Unter **`full-auto` (§1.A)**: `gated` behält alle vier Bestätigungspunkte bei. Vollautomatisch schaltet nur das automatisch weiter
**lokale** Aktionen – das Closeout-Commit + `git checkout main && git merge --ff-only <feature-branch>` (nach
Selbstverifizierung; **fail-fast**, wenn ff-only fehlschlägt). **Alle Remote-Aktionen eskalieren immer** (§1.B.3):
`git push origin <feature-branch>`, `git push origin main`, `git push origin --delete <feature-branch>`, und alle
publish/release. Selbst bei Vollautomatik werden Remote-Git-Aktionen nie gebündelt.

### 4.7 Git Worktree für parallele Sitzungen

Wenn Sie mehrere Treibersitzungen parallel auf einem Computer ausführen, geben Sie jeder Sitzung eine isolierte Funktion
Baum, der einen Git-Verlauf teilt. Nur bei Bedarf verwenden (parallele Aufgaben / eine blockierte Sitzung / Verzweigung).
ohne die nicht festgeschriebenen Änderungen des Hauptarbeitsbaums zu stören); Für einfache sequentielle Arbeit ist dies nicht erforderlich.

**Empfohlenes Layout (Geschwistercontainer):**
```text
~/projects/
├── <repo>/                    # main worktree (default session cwd)
├── <repo>-worktrees/          # sibling container (create once, reuse)
│   ├── <short-alias-1>/
│   └── <short-alias-2>/
```
- Behalten Sie den Container als **Geschwister** im Hauptarbeitsbaum bei und verschachteln Sie ihn nicht darin (doppelte Verschachtelung).
  test/grep/index Sammlung und Bedarf `.gitignore` Unterhalt; Benutzerebene `~/worktrees` entkoppelt
  aus dem Repo und Risiken Backup-Lücken; flach `<repo>-<branch>/` bläht das Projektverzeichnis auf).
- Den Container einmal erstellen und wiederverwenden; `git worktree remove` Ein einzelner Arbeitsbaum, behalten Sie den Container.

**Befehle:**
```bash
mkdir -p ~/projects/<repo>-worktrees
git worktree add ~/projects/<repo>-worktrees/<short-alias> -b <full-branch-name> main
git worktree remove ~/projects/<repo>-worktrees/<short-alias>
git worktree list
```

**Einschränkungen:**
1. In zwei Sitzungen dürfen keine Git-Indexoperationen (`git add`/`commit`) gleichzeitig gegen dasselbe `.git` ausgeführt werden.
2. Der Überprüfungs-MCP-Server wird standardmäßig **nur im Hauptarbeitsbaum** ausgeführt. auch parallele Sitzungen
   weiterleiten oder den manuellen Modus verwenden. Der Brückenbau (`dist/`) ist ein Pro-Worktree-Artefakt und das
   Der MCP-Server hat kein Neuladen während der Sitzung – ein paralleler Arbeitsbaum benötigt einen eigenen Build + Sitzungsneustart.
3. `<full-branch-name>` stimmt mit der Aufgabenkarte überein `design_id` zur Prüfung; Der Kurzpfad-Alias ​​dient lediglich der Zweckmäßigkeit.

## 5. Aufgabenkartenformat

Eine Klartextdatei pro Runde (z. B. `docs/plans/active/<design-id>-<phase>-implement.txt`), mindestens:
```text
stage: implement
module: <module>
goal: <one verifiable point>
scope:
- only touch <files>
non-goals:
- ...
single-commit integrity: yes   # all changes are one atomic subject, one revertible commit
acceptance:
- <test command>
- scripts/verify_*.sh if needed
docs:
- update current.md + the design/impl doc
forbidden:
- do not commit
- do not touch unrelated files
```

## 6. Ausgabevertrag

Der Treiber gibt eine strukturierte Ausgabe bei Implementierung/Reparatur/Abschluss aus (selbstüberprüft, auch ohne
automatisch validierender Wrapper):
1. `docsRead` – Die Ärzte haben diese Runde tatsächlich genutzt.
2. `sopChecks`— welche SOP-Knoten abgeschlossen wurden (Vertragssperre, Design-Synchronisierung, build/verify, Handoff-Synchronisierung).
3. `filesInScope` / `filesChanged`.
4. `testsRun` — Überprüfungsbefehle werden ausgeführt.
5. `validationEvidence` – Schlüsselprotokolle/Schnittstellenergebnisse/Skript PASS/FAIL Auszüge.
6. `handoffUpdated` – ob das Haltepunktdokument aktualisiert wurde.
7. `commit` – ob ein Commit stattgefunden hat; Nicht-Closeout muss sein `performed=false`.
8. `mode` — `driver-led-reviewer-gate` | `driver-led-auto-review` | `reviewer-led-closed-loop`.
8.A `flow` — der §1.D-Flow, unter dem diese Runde lief (`claude+claude` | `claude+codex` | `codex+codex` |
   `codex+claude`); weglassen, wenn das Repo nein hat `[collaboration]` Eigentümerschlüssel (Legacy).
9. `designReview` — `required` | `skipped` | `done`.
10. `knownRisks` / `nextStep` – für eine schnelle Sichtung der Rezensenten.

## 6.A Laufbericht (vollautomatisch)

A **`full-auto` (§1.A)** Lauf endet mit einem einzigen **Laufbericht** (getrennt vom Abschluss jedes Segments),
Aggregieren der §6-Felder im Lauf:
1. **gelieferter Umfang** pro Segment/Slice;
2. Die **Überprüfungskette** jedes Segments – Urteile + Critical/Important zählt + `review_id`s;
3. **aufgerufene Eskalationen + wie sie jeweils gelöst wurden** (§1.B hört auf);
4. **Abweichungen** vom ursprünglichen Plan;
5. Zusammenfassung der **Verifizierungsnachweise** (was wurde selbst verifiziert und was wurde vom Benutzer signiert);
6. `code-home:` pro Segment;
7. **Reste / Rückstand**.

Es landet als prägnanter Bericht in der Abschlussnachricht + als dauerhafter Laufzusammenfassungszeiger `docs/records/current.md`
(standardmäßig keine neue Datei pro Lauf).

## 8. Der geschlossene Kreislauf

### 8.0 Fahrergeführt (Standard), 8 Schritte

(Unter **`full-auto` (§1.A)**: Schritte 2–8 automatisches Vorrücken gemäß §1.B-Prädikat + §1.C Selbstverifizierungsgrenze – die
Der Benutzer wird nur bei einer Eskalation zurückgerufen. andernfalls endet der Lauf mit einem §6.A-Bericht.)

1. Klärung/Brainstorming mit dem Nutzer (§4.2 Trittfrequenz; freigestellt).
2. Fahrer erstellt Design + Aufgabenkarte (`docs/plans/active/`); Richter §4.5 Vorprüfung erforderlich.
3. Wenn komplex / risikoreich → Design-Vorprüfung; Urteil fällen und anpassen. Sonst überspringen.
4. Treiberimplementierungen + Selbsttests + Updates handoff/topic doc; gibt §6-Felder aus.
5. Überprüfung des Prüfercodes → 9.A/9.B/9.C/9.D abgestufte Erkenntnisse.
6. Treiberkorrekturen (Kritisch vor Wichtig), bei Bedarf mit Schritt 5 fortfahren.
7. Der Benutzer führt Überprüfungsskripts aus.
8. Nachdem der Benutzer mit „Test bestanden“ geantwortet hat, wird der Treiber geschlossen (§4.2 Schließung). Push/merge gemäß §4.6.

Unter einem **Split Flow** (§1.D Regel 3) gelten die gleichen 8 Schritte mit zwei Übergabepunkten: nach Schritt 3 die
Der Designer-Treiber schreibt die Implementierungskarte und der Benutzer wechselt zur CLI des Implementierers. Schritte 4–6
(implementieren → Codeüberprüfung → Fix, Reviewer = Gegenstück(implement_owner)) vollständig im ausführen
Sitzung des Implementierers, die dann §6-Ergebnisse + Aktualisierungen meldet `current.md`; Der Benutzer wechselt zurück
an die Fahr-CLI für die Schritte 7–8 (Abnahme + Restposten beim Designer-Fahrer).

### 8.1 Vom Gutachter geleiteter geschlossener Regelkreis (Fallback), 7 Schritte

Wird nur verwendet, wenn Modus 3 explizit ausgewählt ist (§1):
1. Der Prüfer erstellt das Design + die Aufgabenkarte.
2. Der Treiber gibt einen strukturierten Ausführungsplan zurück (`plan` Bühne).
3. Nachdem der Plan bestätigt wurde, implementiert der Fahrer (`implement` Bühne).
4. Der Prüfer überprüft die Commit-/Diff-/Testergebnisse des Treibers (9.A–9.D).
5. Bei Feststellungen behebt der Treiber (`fix` Bühne); Der Gutachter fügt nur Ergebnisse hinzu – das tut er nicht
   Code schreiben oder Skripte selbst testen.
6. Der Benutzer testet lokal oder in der Zielumgebung.
7. Erst nachdem der Benutzer mit „Test bestanden“ geantwortet hat, wird der Abschluss ausgeführt (der Prüfer kann ihn hier durchführen).

## 9. Überprüfungsrahmen

Rollen der vier Abschnitte:
- **9.A** Spec Gate – gegen die Aufgabenkarte: „Wurde es richtig gemacht?“
- **9.B** allgemeine Codequalitäts-Checkliste – anhand von Projekttechnikstandards.
- **9.C** modulspezifische Checkliste – Projekte fügen hier ihre eigenen Unterabschnitte hinzu.
- **9.D** Benotung + Ausgabeformat – alle 9.A/9.B/9.C Der Befund wird gemäß 9.D bewertet und nummeriert.

Auftrags- und Fehlerbehandlung:
1. Gehen Sie in der Reihenfolge 9.A → 9.B → 9.C durch.
2. Jeder Befund verwendet das 9.D-Format`[Critical/Important/Suggestion] (9.x.y) …`.
3. Wenn 9.A ein hat `Critical`: Die Fixkarte dieser Runde erfordert nur die kritischen Punkte 9.A; unkritisch
   9.B/9.C Befunde werden weiterhin aufgelistet und markiert `deferred-to-next-round` (aufgezeichnet, nicht gelöscht).
4. Wenn 9.A besteht: Griff 9.B/9.C gemäß den 9.D-Regeln.

### 9.A Spezifikationskonformität
1. Hat der Treiber das richtige Modul pro Design implementiert (nicht nur auf der Oberfläche)?
2. Reicht der Testnachweis für „ready to test“ aus?
3. Stimmt der Übergabestatus mit dem Codestatus überein?
4. Erfolgte die Schließung erst, nachdem der „Test“ des Benutzers bestanden wurde?

### 9.B Codequalität (allgemein – Beispiele anpassen an `${STACK}`)
1. **Protokollierung durch Helfer gesteuert** – keine reine Ad-hoc-Protokollierung für SQL/cache/profile/inflight/etc.
2. **Keine Wanduhr in Abfertigungsräumen, bei denen a simulation/virtual Uhr ist eingefädelt** – Fädeln Sie den Zeitkontext ein.
3. **Cache-Layer-Konsistenz** – ein neuer Cache-Schlüssel macht alle Layer zusammen ungültig (z. B. verteilt).
   Cache + In-Process-LRU); **Niemals ein globaler Flush** (`FLUSHALL`-Klasse). (erzwungen – SOP §6.4)
4. **Optionale Abhängigkeit nil/None prüft** beim Handler-Eintrag, sodass ein fehlender Dienst beeinträchtigt wird und nicht in Panik gerät.
5. **Parallelitätshygiene** – neu goroutines/tasks Ausgangspfade haben; Kontext ist ausgelotet; Fehler nicht verschluckt.
6. **Konfiguration über Hardcodierung** – table/topic/queue Namen sind env-überschreibbar, nicht fest codiert.
7. **Frontend** – Gemeinsame Wiederverwendung polling-interval/permission Konstanten; Spiegeln Sie neue Berechtigungsflags über Ebenen hinweg.
8. **Commit** – Einzelsubjekt, konventionelle Commits, keine gemischten unaccepted/unrelated Änderungen. (erzwungen)

> §9.B Die oben genannten Beispiele sind stapelförmig; Behalten Sie den *Grundsatz* bei und passen Sie die Betonprüfung an Ihre Bedürfnisse an
> stapeln. Stack/env-specific Prüfungen (CRLF beim Hochladen, Übertragungsratenbeschränkungen, Host-Bereitstellungsbeschränkungen)
> gehören dazu `docs/runbooks/` als Haken, hier nicht.

### 9.C Modulspezifische Checkliste
Standardmäßig leer. Ein Projekt fügt eine hinzu`9.C.<n> <module>`subsection with that module's invariants
(determinism/ordering, Abhängigkeitsminimierung, sprachübergreifende Schemaverträge, Fehlerverhalten,
Zeitgrenzen / No-Lookahead, Geräteisolation, Pipeline-Grenzen, eval/gate Abdeckung). Mark
each declared eval dimension `COVERED / PARTIAL / MISSING`; `PARTIAL`/`MISSING` muss registriert werden
wie mit einem Abschlussplan aufgeschoben, nie stillschweigend verabschiedet.

### 9.D Bewertung (kritisch/wichtig/Vorschlag)
| Ebene | Bedeutung | Handhabung |
|---|---|---|
| `Critical` | Blocks closeout: bug, data loss, security/permission Loch, harte Einschränkungsverletzung (unautorisiertes Commit, globaler Flush, jeder 9.A-Miss) | Muss repariert werden; no closeout until fixed |
| `Important` | Sollte diese Runde reparieren: a 9.B/9.C violation, clear bad smell, latent fault | Fixiere diese Runde; Mai `deferred-to-next-round` wenn außerhalb des Geltungsbereichs oder 9.A Kritische Punkte füllen die Runde |
| `Suggestion` | Stil, Lesbarkeit, kleine Optimierung, vorbeugendes Umschreiben | Beachten Sie es; nicht blockierend; the driver may decline + backlog |

`Critical` muss eine konkrete Trigger- oder Hard-Constraint-Klausel zitieren – nicht „fühlt sich schwerwiegend an“. Die Lösung
card lists findings by level; Fix **Kritisch vor Wichtig**, nie außer Betrieb.

### 9.E Konvergenz + Stop-Loss (wann stoppt die Fix-Schleife)
1. **Abrechnung pro Runde (erzwungen):** im automatischen Lesemodus `verdict_factors.critical_count` /
   `important_count` aus dem Umschlag; im manuellen Modus aufzeichnen `round N: Critical=a Important=b`.
   Track **carried-over Criticals** (same `conclusion_id`/root cause recurring after being marked resolved).
2. **Normal vs. Stillstand:** Kritische Zählungen können steigen und dann fallen (neue Unterprobleme gefunden – normal für groß).
   Aufgaben). **Störung (muss aufhören)**, falls vorhanden: ① derselbe kritische Punkt ist 2 Runden hintereinander ungelöst; ② die
   Critical total fails to drop 2 rounds running; ③ behebt Ping-Pong-Regressionen zwischen denselben Punkten.
3. **On stall:** do not auto-continue. Dem Benutzer melden: der feststeckende Befund (ID + einzeiliger Stamm
   cause), why it won't move, and ≥2 options. Der Benutzer entscheidet.
4. **Round cap + escalation:** auto mode has the `max_review_rounds` Unterbrecher; Der manuelle Modus verfügt über eine weiche
   Obergrenze (Standard ~5) – an der Obergrenze mit geöffneten kritischen Punkten, an den Benutzer eskalieren, kein automatischer Neustart.
5. **Zuerst eine einzige Quelle:** Wiederholte Abweichungen von einer Wahrheitstabelle/einem Vertrag sind eine häufige Ursache für Verzögerungen.
   Überprüfen Sie die einzelne Quelle, bevor Sie die Symptome Runde für Runde beheben.
6. **Mehrphasen-Implementierung – Theke wegwerfen, nicht waschen:** `max_review_rounds` zählt pro
   `design_id`, und Runden bleiben absichtlich über Threads und Neustarts bestehen (ein neuer Thread darf dies nicht tun).
das Budget zurücksetzen). Eine Aufgabe ist also unter **eins** in Phasen aufgeteilt `design_id` akkumuliert jede Phase
   Runden und kann eher auf ein Buchhaltungsartefakt als auf eine ins Stocken geratene Überprüfung stoßen. Wenn Phasen sind
   schwach gekoppelt, geben Sie jedem sein eigenes `design_id` (`<task>-p1`, `-p2`): jede Phase erhält die volle Obergrenze,
   und die Obergrenze wird immer noch **innerhalb** einer Phase durchgesetzt – das belastet das Budget, es wird nicht gewaschen.
   **Kosten:** `design_id` ist auch der Thread-Schlüssel des Rezensenten, sodass eine neue ID einen neuen Thread startet und der
   Die spätere Phase erbt weder das Überprüfungsgespräch der früheren Phase noch das der Entwurfsrunden. Behalten
   eins `design_id` Wenn die Phasen eng gekoppelt sind, lassen Sie den Leistungsschalter stattdessen in 9.E.3 auslösen.

### Ausnahmen
- 9.B/9.C werden nur bei erzwungen implement/fix wenn die Aufgabe das Codeverhalten beeinflusst.
- Einzeldatei copy/comment/pure-doc Änderungen (`docs/**`, `README.md`) sind davon ausgenommen 9.B/9.C.
- Aufgaben berühren source/build/deploy Skripte sind **nicht** ausgenommen.
- 9.D weiche Ausnahme: ≤ 2 Feststellungen, alle `Suggestion` → Prosa ist in Ordnung; irgendein ≥ `Important` → vollständiges 9.D-Format.

## 10. Empfohlene Vorgehensweise

1. Geben Sie dem Fahrer pro Runde einen akzeptablen Unterpunkt, keine phasenübergreifende Megaaufgabe.
2. In `fix`Geben Sie nur die Überprüfungsergebnisse ein, nicht die gesamte Anforderung erneut.
3. Vertrauen Sie der Einschätzung des tatsächlichen Unterschieds durch den Rezensenten und nicht der Selbsteinschätzung des Fahrers.
4. Wenn eine Aufgabe von einem laufenden Dienst abhängt, wird auf der Karte angezeigt: „Bestätigen Sie, dass der Prozess mit dem neuesten Build neu gestartet wird“.
5. Wenn eine Aufgabe davon abhängt cache/log Zur Überprüfung benötigt die Karte das inkrementelle Protokollfenster + die Zwei-Anfrage-Methode.
6. Für höchste Qualität verwenden Sie standardmäßig das stärkste Modell + maximalen Aufwand. niedriger nur unter cost/rate Grenzen (vgl `model-tier-strategy.md`).
7. Wenn der Treiber bei der Implementierung nicht weiterkommt, kann der Prüfer dies tun analyze/triage darf aber nicht die Umsetzung übernehmen.

### 10.A Kontext-Engineering / Subagenten-Offload (Treiberseite)
Single-Thread-Deep-Work ist die Standardeinstellung. Offload ist **kriterienbasiert, nicht standardmäßig**.

**Auf einen Subagenten auslagern** (frischer Kontext, gibt Schlussfolgerungen und keine Datei-Dumps zurück), wenn:
1. Breite Fan-Out-Suche über viele dirs/conventions wo Sie nur die Schlussfolgerung brauchen;
2. eine unabhängige, parallelisierbare Sonde, die schwach an die Hauptleitung gekoppelt ist;
3. eine einmalige Aufgabe mit großem Token, deren Ausgabe auf wenige Zeilen komprimiert wird (Whole-Repo-Grep-Zusammenfassung, External-Doc-Skim).

**Nicht auslagern**, wenn: umfassende Arbeit einen angesammelten schrittübergreifenden Kontext erfordert; Arbeit, die sich grundlegend verändert
Code oder den Sie weiterhin bearbeiten werden; Schlussfolgerungen, die von vielen Zwischenzuständen abhängen.

**Kontextbudgetbewusstsein:** Achten Sie bei langen Sitzungen auf die Kontextebene. In der Nähe der Schwelle landen Sie a
`/handoff` Haltepunkt (und bei Bedarf komprimieren), anstatt ihn in den Kontext zu verrotten.
