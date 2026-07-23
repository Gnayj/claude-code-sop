# ccsop review bridge config. Written into the target repo at .codex-review/config.toml by
# /sop-init. Placeholders <...> are filled by the wizard. The MIN_SAFETY_POLICY
# (sandboxMode=read-only / approvalPolicy=never / network=false / webSearch=false) is enforced by
# the server and cannot be relaxed here.

[meta]
project_id = "<PROJECT_ID>"
project_name = "<PROJECT_NAME>"
language = "<LANGUAGE>"          # the language /sop-init materialized docs in (en | zh | ...)
repo_root = ".."                 # relative to this config file (.codex-review/)
allowed_doc_roots = [
  "docs/",
  ".codex-review/templates/",
]

# Operating autonomy (claude-code-sop-collaboration.md §1.A). OPERATIONAL — the driver reads this;
# the review bridge ignores it. A missing/invalid value is fail-closed to "gated".
#
# Flow matrix (collaboration.md §1.D): who designs × who implements. The review bridge READS the
# two owner keys to derive each stage's reviewer (design review ← counterpart(design_owner);
# code review ← counterpart(implement_owner); fix review inherits the session's reviewer).
# PRECEDENCE / presence semantics:
#   - BOTH owner keys absent  -> legacy mode: [review].provider governs every stage (pre-flow-matrix
#     behavior, back-compat). Keep them absent if you only want a single global reviewer.
#   - ANY owner key present   -> derivation active (a missing counterpart key resolves "claude");
#     [review].provider = codex|claude is then ignored for stage selection.
#   - [review].provider = manual always forces manual delivery for every stage (flows stay valid;
#     the user forwards prompts/verdicts by hand).
#   - Invalid values fail LOUD (bridge starts degraded) — never a silent fallback.
[collaboration]
autonomy = "gated"               # gated (default) | full-auto
# Default flow claude+claude = keys ABSENT (legacy mode, honors [review].provider). /sop-init
# uncomments + fills these only when a non-default flow is chosen:
# design_owner = "claude"        # claude | codex — who designs; the driving session is this CLI
# implement_owner = "claude"     # claude | codex — who implements (fix loop runs in its CLI)

[paths]
sop = "docs/methodology/project-delivery-sop.md"
collaboration_sop = "docs/methodology/claude-code-sop-collaboration.md"
handoff = "docs/records/current.md"
plans_active = "docs/plans/active"
plans_completed = "docs/plans/completed"
sessions_dir = ".codex-review/sessions"
backlog_dir = ".codex-review/backlog"
archive_dir = ".codex-review/archive"

# Which review backend to use (design §4.7). Default codex (cross-model heterogeneity).
[review]
provider = "<REVIEW_PROVIDER>"   # codex | claude | manual

[review.design]
prompt_template = ".codex-review/templates/design-review.md.tpl"
verdict_enum = ["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"]
trigger_clauses = "claude-code-sop-collaboration.md#4.5"

[review.code]
prompt_template = ".codex-review/templates/code-review.md.tpl"
verdict_enum = ["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"]
rule_sections = ["9.A", "9.B", "9.C"]

[review.fix]
prompt_template = ".codex-review/templates/fix-review.md.tpl"
verdict_enum = ["All-fixed", "Partial", "New-issues", "Rereview-after-fixes", "No-Go"]

# Per-provider tuning.
[review.codex]
model = ""                       # "" = SDK default
effort = ""                      # reserved (SDK has no effort field yet)

[review.claude]
model = ""                       # "" = a strong default (claude-opus-4-8)
max_tokens = 16000
key_env = "ANTHROPIC_API_KEY"
context_window = 200000          # basis for the estimated context_usage_pct

[review.manual]
sessions_dir = ""                # "" = reuse paths.sessions_dir

# Doc translation provider (design §4.3 / Q8) — INDEPENDENT of review.provider. When
# review.provider=manual, translation defaults to unsupported (bring your own translated
# templates or set translation.provider explicitly); never silently borrow the review model.
[translation]
provider = "<TRANSLATION_PROVIDER>"   # claude | none ; "none" = BYO translated docs

[state]
lock_timeout_seconds = 30
session_retention_days = 90
backlog_retention_days = 180

[circuit_breakers]
max_design_review_rounds = 3
max_code_review_rounds = 3
max_fix_review_rounds = 3
scope_drift_lines_threshold = 200
context_warn_pct = 0.60
context_force_new_thread_pct = 0.80
codex_failure_streak_threshold = 3
parser_failure_streak_threshold = 3
design_mechanical_max_sections = 8
code_mechanical_max_fix_lines = 100
code_mechanical_max_modules = 1

[safety]
extra_danger_verbs_regex = ""    # may ADD danger patterns; cannot relax MIN_SAFETY_POLICY
