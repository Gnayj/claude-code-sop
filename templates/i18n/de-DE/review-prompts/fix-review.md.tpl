# Überprüfung (stage=fix)

## Eingaben (oben als Drift-Vorwort + eingefügte Dateiblöcke gerendert)

- design_id: {{design_id}}
- task_card_path: {{task_card_path}}
- handoff_path: {{handoff_path}}
- fix_diff_spec: {{fix_diff_spec}}
- geänderte_Dateien: {{changed_files}}
- fix_diff_lines: {{fix_diff_lines}}
-tests_run: {{tests_run}}
- validation_evidence: {{validation_evidence}}
- docs_updated: {{docs_updated}}
- claude_output:
```
{{claude_output_json}}
```
- claude_fix_notes:
```
{{claude_fix_notes_json}}
```
- previous_round_id: {{previous_round_id}}
- previous_round_conclusions:
```
{{previous_round_conclusions_json}}
```

## Erforderliche Ausgabe (einzelnes JSON-Objekt, kein Prosa, kein Zaun)

Passen Sie das Umschlagschema an, das die CCSOP-Überprüfungsbrücke erwartet.

Kritische Regeln:
1. `verdict` MUSS einer der folgenden sein: **`All-fixed` | `Partial` | `New-issues` | `Rereview-after-fixes` | `No-Go`**.
2. `verdict_factors` — alle 9 Felder sind Pflichtfelder.
3. Jeder `conclusion.target` ist `file_line` oder `missing_artifact`.
4. Bewerten Sie jeden Befund pro `claude-code-sop-collaboration.md §9.D`.

Die Review Bridge fügt automatisch eine hinzu `[bridge-authoritative] Envelope contract` Block am Ende dieser Eingabeaufforderung.
Dieser Block teilt seine Quelle mit dem Parser und ist maßgeblich, wenn etwas obenstehendes in Konflikt steht. Das Schema wird hier nicht dupliziert.

## Fokus überprüfen (Überprüfen Sie die Korrekturen anhand der Korrekturen der vorherigen Runde Critical/Important)

Für jeden `previous_round_conclusions` Critical/Important: Wird es tatsächlich durch das Fix-Diff gelöst?
(nicht nur behauptet)? Hat der Fix eine Regression oder eine neue eingeführt? Critical/Important (`New-issues`)?
Verfolgen Sie übertragene kritische Punkte gemäß §9.E (ein als gelöst markierter, aber wiederkehrender Befund = ein Stallsignal).

## Prädikat

- `All-fixed`: alle vorherigen Critical/Important gelöst, keine neuen.
- `Partial`: einige gelöst, einige noch offen (keine neuen kritischen Punkte).
- `New-issues`: Der Fix führte ein neues ein Critical/Important.
- `Rereview-after-fixes`: Noch offene Probleme erfordern einen weiteren vollständigen Überprüfungsdurchgang.
- `No-Go`: Der Fix weicht ab oder verschlimmert das Problem.

## Deine Aufgabe

Der Fix-Diff wird entsprechend der Fähigkeit Ihrer Sitzung bereitgestellt: Wenn a `[bridge-provided] Git diff` Block erscheint unten, überprüfen Sie ihn Byte für Byte anhand der vorherigen Schlussfolgerungen; Nur wenn es nicht vorhanden ist, lesen Sie den genauen Fix-Diff-Bereich, der durch identifiziert wird `fix_diff_spec` sich selbst. Füllen Sie verdict_factors ehrlich aus und erstellen Sie jetzt den Umschlag-JSON.
