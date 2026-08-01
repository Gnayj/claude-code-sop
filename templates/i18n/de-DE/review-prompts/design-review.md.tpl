# Rezension (Bühne=Design)

## Eingaben (oben als Drift-Vorwort + eingefügte Dateiblöcke gerendert)

- design_id: {{design_id}}
- task_card_path: {{task_card_path}}
- handoff_path: {{handoff_path}}
-triggers_hit: {{triggers_hit}}
- previous_round_id (falls vorhanden): {{previous_round_id}}
- previous_round_resolved (falls vorhanden):
```
{{previous_round_resolved_json}}
```
- apply_edits (falls vorhanden):
```
{{applied_edits_json}}
```

## Erforderliche Ausgabe (einzelnes JSON-Objekt, kein Prosa, kein Zaun)

Passen Sie das Reviewer-Payload-Schema an, das die CCSOP-Überprüfungsbrücke erwartet. Die
serverseitigen Felder des endgültigen Umschlags werden von der Brücke ergänzt; geben Sie sie nicht aus.

Kritische Regeln:
1. `verdict` MUSS einer der folgenden sein: **`Go` | `Go-after-fixes` | `Rereview-after-fixes` | `No-Go`** (NICHT `Pass` – das ist die Codephase).
2. `verdict_factors` — alle 9 Felder sind Pflichtfelder.
3. Jeder `conclusion.target` ist `file_line` oder `missing_artifact`.
4. Bewerten Sie jeden Befund pro `claude-code-sop-collaboration.md §9.D`.

Die Review Bridge fügt automatisch einen `[bridge-authoritative] Reviewer payload contract`-Block am Ende dieser Eingabeaufforderung hinzu.
Dieser Block teilt seine Quelle mit dem Parser und ist maßgeblich, wenn etwas obenstehendes in Konflikt steht. Das Schema wird hier nicht dupliziert.

## Überprüfungsschwerpunkt (Design-Vorüberprüfung – `claude-code-sop-collaboration.md §4.5`)

Überprüfen Sie das Design anhand der Auslöser, die ausgelöst wurden ({{triggers_hit}}):
1. Ist der Umfang/die Nichtziele/die Akzeptanz klar und intern konsistent?
2. Sind externe Schnittstellen-/Schema-/Berechtigungs-/Bereitstellungs-/Datenmigrationsänderungen sicher und reversibel?
3. Sind die gesperrten Entscheidungen (Q1-QN) kohärent und bleibt irgendetwas als ungelöste offene Frage übrig?
4. Netzneue Abstraktionen / übergreifende Konsistenz / Rollback-Plan vorhanden?

## Prädikat

- `Go`: keine kritische, keine ungelöste offene Designentscheidung.
- `Go-after-fixes`: Es bestehen Probleme, die jedoch alle mechanisch behoben werden können (affected_major_sections_count ≤ {{design_mechanical_max_sections}}, !new_arch_concept, !interdependent_rc, !open_design_decision).
- `Rereview-after-fixes`: Es liegen Probleme vor UND eine dieser mechanischen Grenzen wurde überschritten.
- `No-Go`: Das Design ist strukturell falsch; Neugestaltung.

## Deine Aufgabe

Lesen Sie das Designdokument + die Aufgabenkarte, bewerten Sie die Auslöser gemäß §4.5, füllen Sie verdict_factors ehrlich aus und erstellen Sie jetzt das Reviewer-Payload-JSON.
