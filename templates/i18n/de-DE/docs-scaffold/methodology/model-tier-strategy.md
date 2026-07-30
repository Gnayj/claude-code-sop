# Modellebenenstrategie

> ccsop canonical (Englisch). Macht die ansonsten verstreute Modellschichtung deutlich
> das Kooperationsprotokoll (§10 / §10.A) und das jedes Agenten `model:` frontmatter. Prinzip:
> **Passen Sie die Modellleistung an die Argumentationsanforderungen der Aufgabe an** – starke Modelle für Urteilsvermögen und tiefgreifende Arbeit,
> eine günstigere Stufe für die mechanische Ausführung, Subagenten mit frischem Kontext für das Fan-Out und eine unabhängige Version
> (vorzugsweise heterogenes) Modell zur Überprüfung.

## 1. Stufen nach Stufe

| Bühne / Werk | Stufe | Begründung |
|---|---|---|
| Design / tiefgreifende Umsetzung / Korrektur des Urteils (die Hauptsitzung) | **Stärkstes Modell + maximaler Aufwand** (Standard) | Schrittübergreifende kohärente Argumentation, Architektur, Kompromisse – der Teil, in dem Qualität entsteht. |
| Mechanische Ausführung: Überprüfung der Beweissammlung, Dokumentensynchronisierung, Bereitstellung pro Runbook | **Günstigerer Subagent der „Downgrade“-Stufe** (z. B. `sonnet`) | Der Vertrag lautet: „Führen Sie die Schritte aus, zeichnen Sie sie wörtlich auf, interpretieren Sie sie nicht“; Die Interpretation bleibt in der Hauptsitzung (stark). Das sind die `verify-runner` / `doc-sync` / `deploy-runner` Agenten. |
| Fan-out-Suche / einmaliges großes Token „auf wenige Zeilen komprimieren“ | **Frischkontext-Subagent** (`Explore` / `general-purpose`) | Gibt Schlussfolgerungen zurück, keine Dateidumps; Hält das Hauptfenster sauber. Kriterien: Zusammenarbeit §10.A. |
| Überprüfung (Design / Code / Korrektur) | **Die model/instance `review.provider` wählt** | Heterogenität bevorzugt (`codex` Standardeinstellung): Ein unabhängiges Modell erfasst tote Winkel, die das eigene Modell des Fahrers übersieht. `claude` Der Anbieter verliert diese Heterogenität – siehe seinen Vorbehalt. |

## 2. Kosten-/Tarifherabstufung

Standardmäßig wird das **stärkste Modell + maximaler Aufwand** für Implementierungs-/Tiefenarbeiten verwendet. Senken Sie das Modell bzw
Aufwand **nur** unter Kosten- oder Preislimitdruck – und vermerken Sie dies in den Notizen der Runde. Nicht
stillschweigend die Beurteilungsstufe herabstufen; Ein schwächeres Modell für eine Beurteilungsaufgabe ist eine falsche Ökonomie
wird als Nacharbeit angezeigt.

## 3. Vertrag auf mechanischer Ebene (warum eine günstigere Ebene hier sicher ist)

Die Downgrade-Stufe ist genau deshalb sicher, weil die Agenten darauf beschränkt sind, *kein Urteil* zu fällen:
- `verify-runner` sammelt Beweise wörtlich und entscheidet nicht PASS/FAIL.
- `doc-sync` schreibt bestätigte Fakten in einen benannten Abschnitt und erfindet nichts.
- `deploy-runner` Folgt einem Runbook Schritt für Schritt und stoppt bei jeder Anomalie.

In der starken Hauptsitzung wird die Aufgabe festgelegt, Erwartungen vermittelt und die Ergebnisse interpretiert. Wenn ein
Da eine Aufgabe mitten im Prozess interpretiert werden muss, gehört sie nicht zur mechanischen Ebene.

## 4. Agenten in Cron – Grenze

Die Wiederverwendung abgestufter Agenten in geplanten (Cron-)Jobs hat ihre Grenzen und kann leicht zu stark verallgemeinert werden:

- **Fügen Sie KEINEN Überwachungs-/Beurteilungsmittel in cron ein.** Ein Monitor, der selbst unzuverlässig sein kann
(Modell-Schluckauf, Ratenbegrenzung, schlechte Analyse) ist als Watchdog widersprüchlich. Für unbeaufsichtigt
  Für regelmäßige Überprüfungen verwenden Sie einen deterministischen **Shell-Sentinel** (ein Bash-Skript mit expliziten Schwellenwerten +
  Alarmierung), kein LLM-Agent.
- **Degradierbare Batch-Arbeit kann in Cron ausgeführt werden** – Arbeit, bei der ein verpasster oder degradierter Lauf tolerierbar ist und
  sich beim nächsten Lauf selbst korrigiert und keine Beurteilung in Echtzeit erforderlich ist.
- **Verallgemeinern Sie dies nicht zu sehr, indem Sie sagen: „Niemals einen Agenten in Cron einfügen“.** Bei der Regel geht es um *Überwachung /
  Beurteilungspositionen*, nicht alle geplanten Arbeiten.

## 5. Landung

Dieses Dokument und das jedes Agenten `model:` (und `effort:`) Frontmatter verstärken sich gegenseitig: die
Die Tabelle hier gibt die Richtlinie an; der Agent Frontmatter (`agents/*.md`) ist dort, wo es pro Agent landet.
Wenn sich die Richtlinie ändert, aktualisieren Sie beide – oder, noch besser, behalten Sie die Richtlinie pro Agent bei `model:` im Einklang mit dem
Die Stufe, die dieses Dokument der Rolle dieses Agenten zuordnet.
