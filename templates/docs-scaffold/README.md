# docs/ — layering map

This repository follows the **ccsop** delivery workflow. Documentation is layered:

| Dir | Holds |
|---|---|
| `records/` | `current.md` (live breakpoint) + `archive/<period>.md` (historical increments) |
| `methodology/` | delivery SOP, collaboration protocol, workflow overview, model-tier strategy (ccsop canonical; updated via `/sop-update`) |
| `plans/` | `active/` + `completed/` task cards, and the `_template-{design,implement}.txt` templates |
| `design/` | module-level feature designs and architecture |
| `runbooks/` | environment, deploy, run, verification steps (stack/env-specific hooks) |
| `references/` | schemas, generated artifacts, static reference material |

**Start here**: invoke `/handoff` (or read `records/current.md`) for current state. Rules live in
`methodology/project-delivery-sop.md` (single source); the `project-sop` skill is the execution map.

Managed-file provenance is tracked in `.ccsop/manifest.json` (per-file owner + source/render
hashes, plus a maintained-translation source hash for translated docs). Files with `owner=ccsop`
are maintained by `/sop-update`; `records/current.md` is `owner=overlay` (yours). To add your own
content **inside** a managed Markdown doc without forking it, wrap it in a consumer extension block
(`<!-- consumer:begin <slug> anchor="<section>" -->` … `<!-- consumer:end <slug> -->`) — updates
preserve it in place.
