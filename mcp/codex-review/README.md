# @gnayj/ccsop-review-mcp

MCP server that gives Claude Code automated **design / code / fix review** through a
pluggable `ReviewProvider` abstraction. The provider is chosen by `review.provider` in
`.codex-review/config.toml`:

- `codex` (default) — review via the Codex SDK (`@openai/codex-sdk`). Cross-model review.
- `claude` — review via the Anthropic SDK (slice 3).
- `manual` — write a prompt for a human / external reviewer, ingest the pasted verdict (slice 3).

The orchestrator owns parsing, the server-authoritative envelope, usage accounting,
context/thread management, drift detection, and circuit breakers; a provider only produces
one raw review turn (design §4.7).

This package ships inside the **ccsop** plugin and is wired via the plugin manifest's
`mcpServers` entry. Review-prompt templates and config are scaffolded into the target repo by
`/sop-init`.

## Build

```bash
cd mcp/codex-review
npm install
npm run build
npm test
```

(The ccsop install wizard runs the install + build for you — design §4.9.)

## Tools exposed via MCP

- `codex_design_review` — design pre-review (only when SOP §4.5 triggers are hit)
- `codex_code_review` — run after an implement slice
- `codex_fix_review` — run after applying review fixes

Verdict enums and the envelope schema are defined per stage in `config.toml`.

## Configuration

See the `[review]` section of `.codex-review/config.toml`: `provider`, the per-stage
`[review.design|code|fix]` templates/verdict enums, and the per-provider
`[review.codex|claude|manual]` subtables.
