# Workflow-Übersicht – Fahrergeführt + Prüfer

> End-to-End-Übersicht über die `driver-led + auto review` Ablauf, Integration der SOP, Zusammenarbeit
> Protokoll und Review-Bridge-Design. **Keine neuen Regeln** – nur Integration + Kurzreferenz.
> „Treiber“ = implementierender Agent; „Rezensent“ = was auch immer `review.provider` wählt.

## 1. Kollaborationsmodi (Kurzreferenz)

Zwei Live-Modi (siehe `claude-code-sop-collaboration.md §1`):

| Modus | Überprüfen Sie die Kommunikation | implementieren / schließen | Wann |
|---|---|---|---|
| **`driver-led + auto review`** (Standard, wenn die Brücke verkabelt ist) | MCP ruft den Prüfer automatisch auf (`codex_design_review` / `codex_code_review` / `codex_fix_review`) | Treiber implementiert + schließt aus | tägliche Iteration |
| `driver-led + reviewer gate` | Benutzer leitet Diff / Urteil **manuell** weiter (oder `review.provider=manual`) | Treiber implementiert + schließt aus | Brücke ausgefallen oder manuelle Steuerung gewünscht |
| `reviewer-led closed loop` (Rückfall, ruhend) | user/automation weitergeleitet | Der Prüfer besitzt Design + Abnahme + Abschluss; Treiber implementiert | Im Besitz des Rezensenten design/acceptance gesucht (siehe Zusammenarbeit §1 Modus 3 / §8.1) |

Split-Flow-Vorschlagsadapter sind optionale Transportmittel, keine neue Autorität:
`claude+codex` verwenden darf `codex_implement`; Schema-2 `codex+claude` darf die selbständig nutzen
vom Bediener aktiviert `claude_implement` unter Linux+bwrap. Beide Return-Patches nur. Eine unkonfigurierte
Die Claude-Validierungsphase ist explizit `advisory-only / export-only`.

## 2. End-to-End-Ablauf

```
(1) Requirement clarification
    Driver-led; SOP §4 "chunked confirmation"; user sets business goal + acceptance signal
        ↓
(2) Design
    Driver writes design.md; lock decisions if the user answered Q1-QN
    Output: docs/methodology/<id>-design.md  or  docs/design/<module>/...
        ↓
   §4.5 trigger hit? ── no ──→ skip design review
        │ yes
        ↓
(3) codex_design_review (auto)   verdict ∈ {Go, Go-after-fixes, Rereview-after-fixes, No-Go}
        Go / Go-after-fixes      → mechanical fix → implement
        Rereview-after-fixes     → fix → re-review
        No-Go                    → stop, report user, redesign
        ↓
(4) Implement   on a feature branch off main (branch = design-id or custom)
    N=1 single round: no implement card; N≥2: one card per phase
    each commit single-subject
        ↓
(5) simplify pre-test pre-screen  (Claude /simplify | Codex $simplify; allowlisted code ≥30 add+del vs main)
    TRIGGER → run owner skill → self-fix → re-run until clean
    EXEMPT / unavailable → skip + record reason (non-blocking)
        ↓
(6) Self-test (driver)   build / test / incremental log window / verify scripts (SOP §6.4)
        ↓
(7) codex_code_review (auto)   verdict ∈ {Pass, Pass-after-fixes, Rereview-after-fixes, No-Go}
        Pass / Pass-after-fixes  → mechanical fix → "ready to test"
        Rereview-after-fixes     → fix → re-review (breaker after the round cap)
        No-Go                    → stop, report user
        ↓
(8) User verify   user runs verify commands, replies "test passed" / "failed: X"
        "test passed" → Closeout      "failed" → still implement; fix → re-test
        ↓
(9) Closeout (driver, single commit)   handoff closeout + task-card archive + code-home: line
    N=1: append closeout summary to design.md implementation-record section
    N≥2: archive each phase's implement card to docs/plans/completed/<module>/
        ↓
(10) Merge to main (collaboration §4.6, 4 confirmation points)
    push feature → ff-only merge main → push main → delete remote feature; each confirmed separately
```

## 3. Artefakte pro Stufe

| Bühne | Artefakt | Pfad |
|---|---|---|
| (2) Design | `<design-id>-design.md` | `docs/methodology/` (Methodik) / `docs/design/<module>/` (Funktion) |
| (3) Entwurfsprüfung | Rezensionsumschlag | Brückenzustand; design.md top zeichnet die Überprüfungskette auf (Urteil der Runde N + IDs finden) |
| (4) Implementieren | Feature-Zweig vom Hauptzweig | `<design-id>` oder benutzerdefiniert |
| (4) Gerätekarte | eine pro Phase in Mehrrunden | `docs/plans/active/<design-id>-<phase>-implement.txt` (Einzelrunde: keine) |
| (5) vereinfachen | Selbsttest-Nachweis | Implementieren Sie die Festschreibung/Überprüfung von BeweisaufzeichnungenTRIGGER/EXEMPT+ Grund |
| (6) Selbsttest | Skripte/Schnittstellenergebnisse überprüfen | `scripts/verify_*.sh` (Laufzeitfunktionen) + inkrementelle Protokolle |
| (7) Codeüberprüfung | Rezensionsumschlag | Brückenzustand; Closeout-Commit verweist auf die Überprüfungskette |
| (8) Benutzerüberprüfung | „Test bestanden“ / „nicht bestanden: X“ | Benutzerantwort |
| (9) Restposten | Abschluss-Commit + Archiv | N=1: Entwurfsimplementierungsdatensatz; N≥2: Karte + implementieren `completed/<module>/` |
| (9) `code-home:` | einzelner Schlüssel:Wertzeile | Dokumentende entwerfen oder Kartenende implementieren |
| (10) Zusammenführen | ff-only merge + main push | `code-home:` hinterfüllt mit Sha |

## 4. Einzelne design.md vs. design+implement-Karten

- **Einzelnes design.md (Standard):** eins `<id>-design.md` ist sowohl das Design als auch der runde Vertrag;
  Setzen Sie Karten nur für Mehrrunden-/Mehrpersonenstaffeln ein. Geeignet für die automatische Überprüfung (keine Karte als Relais erforderlich).
- **Zwei Karten (Legacy):** separate Design- und Implementierungskarten; eignet sich für einen vom Prüfer geleiteten Split-Flow.

Entscheidungsmatrix (identisch mit `collaboration §4.1`):

| Entwurfsumfangsphasen | Karte umsetzen |
|---|---|
| N=1 Einzelrunde | keine; Abschlusszusammenfassung → Design-Implementierungsdatensatz |
| N≥2 unabhängige Glattstellungsphasen | eine pro Phase (von `_template-implement.txt`) |
| N=1 Pause in der Mitte der Runde / Staffel | eine Karte, erstellt am Phasenschalter |

## 5. Übergabe und Vereinfachung im Ablauf

| Geschicklichkeit | Bühne | Auslöser | Ausgabe / Verhalten |
|---|---|---|---|
| Claude `/handoff` / Codex `$handoff` | vor (1) / Sitzungsstart / Wechsel der aktiven Aufgabe | Der Benutzer sagt: „Fahren Sie gemäß SOP fort / wie ist der Status / fahren Sie mit <Aufgabe> fort“ | noch einmal lesen `current.md`; strukturierte Übergabe |
| Claude `/simplify` / Codex `$simplify` | (5) nach der Implementierung, vor dem Selbsttest | Inline generierte Kriterien unten; Codex liest auch sein kanonisches JSON | Vier-Ecken-Vorsieb; Treiber-Selbstreparaturen; ersetzt nicht den Rezensenten |

Lesbare Triggerkriterien, generiert aus `SIMPLIFY_CONTRACT_V1` (reine Claude-Consumer sind damit
nicht von einem Codex-Gerüstpfad abhängig):

- Allowlist für Codepfade: `.go`, `.vue`, `.ts`, `.tsx`, `.js`, `.py`, `.sh`.
- Auslösen, sobald die Summe aus hinzugefügten und entfernten Zeilen des erlaubten Codes im Diff aus committed + staged + unstaged + untracked gegen die Basisreferenz `main` insgesamt `30` erreicht.
- Ausgenommen sind Nicht-Git-Repositories, eine fehlende Basisreferenz `main`, ein detached HEAD, reine Dokumentations-/SOP-/Tippfehleränderungen oder Fälle, in denen der erlaubte Code unterhalb des Schwellenwerts bleibt.

## 6. Fehlermodi

| Symptom | Pfad | Quelle |
|---|---|---|
| `codex_code_review = No-Go` | stoppen; Benutzer melden; Schleife nicht automatisch neu starten | Zusammenarbeit §3 |
| `codex_code_review` wiederholt `Rereview-after-fixes` hinter der Kappe | Brecherbrände; anhalten, melden | Brückendesign (Leistungsschalter) |
| `codex_design_review = No-Go` | Neugestaltung; Geben Sie nicht „implement |“ ein Zusammenarbeit §4.5 |
| Vereinfachen Sie falsch positive | Inline-Notiz + Nachweis „kein Problem: <Grund>“; Weiter zum Gutachter (der noch ablehnen kann) | SOP §5.A |
| Benutzerüberprüfung „fehlgeschlagen: X“ | nicht geschlossen; beheben → erneuten Selbsttest → erneuten Test; kein Abschluss-Commit | SOP §6.3 |
| Build/Test schlägt fehl | normaler In-Implementierungs-Fix; nicht „bereit zum Testen“ melden | SOP §5 |
| Bridge/Anbieter nicht verfügbar | auf manuelle Weiterleitung umstellen; Grund aufzeichnen; Auto-Kanal nicht automatisch neu starten | Zusammenarbeit §3 |
| §4.5 Auslöser unklar | Standardmäßig auf Vorüberprüfung | Zusammenarbeit §4.5 |
| ff-only-Merge schlägt fehl (diverged) | Pause; rebasieren Sie nicht auf eigene Faust; Benutzer melden | Zusammenarbeit §4.6 |
| Sitzung blockiert (Fix-Schleife bleibt hängen / wartet auf Benutzer) | Starten Sie einen Git-Arbeitsbaum und führen Sie eine weitere Sitzung für andere Arbeiten aus | Zusammenarbeit §4.7 |
| Übergabe verpasster Schlüsselinformationen | Lesen Sie die vollständige Aufgabenkarte/das Designdokument erneut, nachdem Sie | aufgerufen haben Zusammenarbeit §4 |
| vereinfachen nicht verfügbar | überspringen + Grund aufzeichnen; nicht blockierend | SOP §5.A |
| Fix-Schleife konvergiert nicht (gleiche kritische Wiederholungen / kritische Gesamtsumme flach 2 Runden / Regressions-Ping-Pong) | Markieren Sie den Stand; stoppen; Divergenz + ≥2 Optionen melden; eskalieren am Softcap | Zusammenarbeit §9.E |
| trial/diagnostic Patch im Hauptcode übrig | Ermittlungen erfolgen in Wegwerfskripten + Drei-Staaten-Urteil; Temporäre Hauptcodeänderungen werden bei Abschluss registriert, bereinigt oder konsolidiert | SOP §13 + §14 |

## 7. Rollback-Playbook (nach Erreichen des Punktes)

| Staat | Rollback | Risiko |
|---|---|---|
| lokaler Arbeitsbaum, nicht festgeschrieben | `git checkout -- <file>` / erneut bearbeiten | keine – reversibel |
| verpflichtet, nicht gedrängt | `git reset --hard HEAD~N` | **destruktiv – separate Benutzerbestätigung** (SOP §4.1) |
| Push-Feature-Zweig (nicht zusammengeführt) | `git revert <sha>` + Push oder Remote-Zweig löschen (vom Benutzer autorisiert) | Nicht-Umschreiben |
| ff-only merged main, main nicht gepusht | `git reset --hard <pre-merge-sha>` | **destruktiv – separate Benutzerbestätigung** |
| geschoben main | `git revert <sha>` + einen neuen Commit pushen; **kein gewaltsamer Druck** | Force-Push ist verboten |
| für die Produktion bereitgestellt | Stellen Sie die alte Binärdatei + bereit `git revert` + neues Commit (siehe `docs/runbooks/`); **Benutzer zuerst melden** | hohes Risiko; nicht automatisch erlaubt |
| Designfehler nach der Schließung (kein Fehler) | Setzen Sie das Abschluss-Commit zurück + ziehen Sie das Design zurück zum Entwurf + korrigieren Sie es und führen Sie die Designüberprüfung erneut durch | selten; Der Rezensent hätte es verstehen sollen |

## 8. Referenzen

- Modi + Rollen + Pflichteingaben: `claude-code-sop-collaboration.md §1 / §2 / §4`
- Aufgabenkartenkonvention: `claude-code-sop-collaboration.md §4.1`
- §4.5 Design-Vorprüfungsauslöser / §4.6 Zusammenführungsbestätigungspunkte / §4.7 Arbeitsbaum: `claude-code-sop-collaboration.md`
- Review-Framework + Konvergenz + Subagenten-Offload: `claude-code-sop-collaboration.md §9 / §10.A`
- Feature-Checkliste + Test-SOP + Bug-SOP + Spike + Closeout-Selbstprüfung + Dep-Legitimität: `project-delivery-sop.md §5/§6/§12/§13/§14/§9`
- Modellstufen: `model-tier-strategy.md`
- Review Bridge (Envelope Schema / verdict_factors): das ccsop review MCP (`mcp/codex-review`)
