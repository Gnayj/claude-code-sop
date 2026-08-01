# Überprüfung (stage=code)

## Eingaben (oben als Drift-Vorwort + eingefügte Dateiblöcke gerendert)

- design_id: {{design_id}}
- task_card_path: {{task_card_path}}
- handoff_path: {{handoff_path}}
- diff_spec: {{diff_spec}}
- geänderte_Dateien: {{changed_files}}
-tests_run: {{tests_run}}
- validation_evidence: {{validation_evidence}}
- docs_updated: {{docs_updated}}
- claude_output:
```
{{claude_output_json}}
```
- previous_round_id (falls vorhanden): {{previous_round_id}}
- previous_round_resolved (falls vorhanden):
```
{{previous_round_resolved_json}}
```
- Applied_fixes (falls vorhanden):
```
{{applied_fixes_json}}
```

## Erforderliche Ausgabe (einzelnes JSON-Objekt, kein Prosa, kein Zaun)

Passen Sie das Reviewer-Payload-Schema an, das die CCSOP-Überprüfungsbrücke erwartet. Die
serverseitigen Felder des endgültigen Umschlags werden von der Brücke ergänzt; geben Sie sie nicht aus.

Kritische Regeln:
1. `verdict` MUSS einer der folgenden sein: **`Pass` | `Pass-after-fixes` | `Rereview-after-fixes` | `No-Go`**.
2. `verdict_factors` — alle 9 Felder sind Pflichtfelder.
3. Jeder `conclusion.target` ist `file_line` oder `missing_artifact`.
4. Bewerten Sie jeden Befund pro `claude-code-sop-collaboration.md §9.D`.

Die Review Bridge fügt automatisch einen `[bridge-authoritative] Reviewer payload contract`-Block am Ende dieser Eingabeaufforderung hinzu.
Dieser Block teilt seine Quelle mit dem Parser und ist maßgeblich, wenn etwas obenstehendes in Konflikt steht. Das Schema wird hier nicht dupliziert.

## Überprüfungsreihenfolge – §9.A → §9.B → §9.C (siehe claude-code-sop-collaboration.md §9)

§9.A Spezifikationskonformität (gegen `task_card_path`):
1. Das richtige Modul pro Design implementiert, nicht nur auf der Oberfläche?
2. Testnachweis ausreichend für „ready to test“?
3. Stimmt der Übergabestatus mit dem Codestatus überein?
4. Abschluss (falls vorhanden) erst, nachdem der „Test“ des Benutzers bestanden wurde?

§9.B Codequalität (allgemein – wenden Sie die §9.B-Prinzipien an; passen Sie die konkrete Prüfung an den Stapel dieses Projekts an):
Holzeinschlag durch Helfer eingedämmt; keine wanduhr wo a sim/virtual Uhr ist mit Gewinde versehen; Cache-Schicht
Konsistenz ohne globales Flush; optionale Abhängigkeit nil/None Schecks; Parallelitäts-Exit-Pfade +
Kontext-Sanitär; Konfiguration über Hardcodierung; Ständige Frontend-Wiederverwendung / Ebenenübergreifende Berechtigungsspiegelung;
Einzelsubjekt-Konventional-Commit.

§9.C modulspezifische Qualität (nur wenn dieses Projekt a `9.C.<n>` Block für das aktive Modul).

## Prädikat (§9.D-Bewertung + das Urteilsprädikat der Brücke)

- `Pass`: kritische_Anzahl == 0 UND wichtige_Anzahl == 0.
- `Pass-after-fixes`: Es gibt Probleme UND jeder Fix hat eine file_line/missing_artifact Ziel, touched_module_count ≤ {{code_mechanical_max_modules}}, !new_arch_concept, geschätzte_fix_lines ≤ {{code_mechanical_max_fix_lines}}, !design_gap.
- `Rereview-after-fixes`: Es liegen Probleme vor UND eines von: touched_module_count > {{code_mechanical_max_modules}}, new_arch_concept, geschätzte_fix_lines > {{code_mechanical_max_fix_lines}}, design_gap.
- `No-Go`: Implementierung weicht von Spezifikation ab.

## Deine Aufgabe

Der Codeunterschied wird entsprechend der Fähigkeit Ihrer Sitzung bereitgestellt: Wenn ein `[bridge-provided] Git diff`-Block unten erscheint, überprüfen Sie ihn Byte für Byte; nur wenn er fehlt, lesen Sie selbst den durch `diff_spec` bezeichneten genauen Diff-Bereich. Führen Sie dann §9.A → §9.B → §9.C der Reihe nach aus, füllen Sie verdict_factors ehrlich aus und erstellen Sie jetzt das Reviewer-Payload-JSON.
