---
name: sop-flow
description: Zeigen Sie den ständigen CCSOP-Ablauf für Codex-gesteuerte Arbeit an oder legen Sie ihn explizit fest: Codex+Codex oder Codex+Claude.
---

# SOP-Flow

Lesen `references/contract.md`.

- Leere Argumente oder implizite Aktivierung sind schreibgeschützt: Aufruf `ccsop_configure` mit
  `action=status`, dann den Strom anzeigen owners/reviewers und die beiden rechtlichen, vom Codex gesteuerten Entscheidungen.
- Nur explizit `$sop-flow codex+codex` oder `$sop-flow codex+claude` kann mutieren.
- Rufen Sie vor der Mutation den Status auf und erfordern Sie `contract_version=2` und
  `observed_schema=1|2`. Dann rufen Sie an `ccsop_configure` mit `action=set-flow`,
  `expected_config_sha256=<status after_sha256>`, und der angeforderte Fluss.
- Wenn Statusberichte `config_valid=false`, zeigen Sie den Validierungsfehler und die Rohbesitzer an. Eine legale
  Der explizite Satz repariert möglicherweise die Eigentümerschlüssel nur, wenn die resultierende gesamte Konfiguration validiert wird. ein
  Ein unabhängiger Fehler ist ein Null-Schreibfehler. Zeigen Sie auf `/sop-update` oder eine verifizierte
  `.ccsop/backups/config/<sha256>.toml` Vorbild, niemals ein Fallback für die manuelle Bearbeitung.
- Ablehnen `claude+*` und zeige auf Claude `/sop-flow`.
- Für Schema 1 melden `codex+claude` als `delivery=manual relay` und anbieten `/sop-update`.
- Für Schema 2 muss der Live-Tool-Katalog enthalten sein `claude_implement`, berichten
  readiness/validation/apply Richtlinie aus dem Status und erklären Sie, dass die Flow-Auswahl nie aktiviert wird
  der Schriftsteller. Der Betreiber kann sich nur außerhalb der Agentensitzung anmelden, indem er das Generierte ändert
  `enabled=false`; Dieser Skill führt niemals eine agentenseitige Aktivierung durch oder schlägt diese vor.
- Wenn Sie Eigentümerwechsel vornehmen, zeigen Sie die des Servers an `safety_disable=true` und das Gezwungene
  `[implement.claude].enabled=false`.
- Wenn das Tool fehlt, alt ist oder die Bridge nicht neu gestartet wurde, führen Sie keine Schreibvorgänge durch und informieren Sie den Benutzer
zu reconnect/restart `/mcp`. Bearbeiten Sie niemals TOML und verwenden Sie niemals ein Shell-Fallback.
