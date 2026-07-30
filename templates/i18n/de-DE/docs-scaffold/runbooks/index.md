# Runbooks-Index

Umgebungs-, Bereitstellungs-, Ausführungs- und Überprüfungsschritte sind hier live verfügbar. **Stack/env-specific Haken** (gemäß SOP
§2.3) gehören hierher, nicht in die Methodendokumente – z.B. Zeilenende-Upload-Prüfungen (CRLF), Übertragung
Tarifbegrenzungen (`${RSYNC_BWLIMIT}`), hostspezifische Bereitstellungseinschränkungen, Dienstneustartverfahren.

Die `deploy-runner` Der Agent folgt einem Runbook Schritt für Schritt und stoppt bei jeder Anomalie; jeweils erklären
Geben Sie hier das Ziel der Bereitstellung, die erwarteten Ergebnisse und alle Stack-Hooks an, damit der Agent sie hat.

| Runbook | Zweck |
|---|---|
| <Pfad> | <eine Zeile> |
