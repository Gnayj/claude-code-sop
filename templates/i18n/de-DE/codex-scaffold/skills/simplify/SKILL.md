---
name: simplify
description: Ordnet die aktuelle Änderung anhand des ccsop-Schwellenwerts ein und prüft anschließend Wiederverwendung, Qualität, Effizienz und Abdeckung; ein expliziter Aufruf behebt Befunde und führt gezielte Tests erneut aus.
---

# Simplify

Lesen Sie `references/contract.json`; diese Datei ist die maschinenlesbare Wahrheit. Leiten Sie
Schwellenwerte nicht aus dem Methodiktext ab.

1. Prüfen Sie, ob dies ein Git-Feature-Branch mit der konfigurierten Basisreferenz ist. Andernfalls
   melden Sie `EXEMPT` mit dem genauen Grund.
2. Summieren Sie hinzugefügte und entfernte Zeilen für erlaubte Code-Endungen über committed,
   staged, unstaged und untracked Änderungen, ohne Pfade doppelt zu zählen. Belegen Sie jedes
   Segment einzeln.
3. Liegt die Summe unter dem Schwellenwert oder gibt es keine passende Endung, melden Sie
   `EXEMPT`; andernfalls `TRIGGER`.
4. Prüfen Sie den geänderten Code aus vier Blickwinkeln: Wiederverwendung, Qualität, Effizienz und
   Abdeckung.
5. Bei einem expliziten `$simplify` oder einer ausdrücklichen Aufforderung zum Vereinfachen und
   Beheben bearbeiten Sie nur Dateien im Aufgabenbereich, beheben echte Befunde, führen gezielte
   Tests erneut aus und legen die Ergebnisse vor. Bei einem impliziten Trigger diagnostizieren
   Sie nur und fragen vor jeder Bearbeitung nach.

Dies ist eine kostengünstige Vorprüfung und kein Ersatz für das vorgeschriebene
modellübergreifende Codereview.
