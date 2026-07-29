# ccsop tier contract v2

- `claude-review` → `[review.claude] backend/model/effort`。
- `codex-review` → `[review.codex] model/effort`。
- `codex-dispatch` → `[implement] model/effort`（只控制 `codex_implement`）。
- `codex-default` → `[codex] default_model/default_effort`。
- schema=2 新增 `claude-implement` → `[implement.claude]` model/effort 与 shrink-only timeout/output/budget/ledger cap。
- backend/cli_path/version override/validation/additive globs/advisory apply/enabled 全部 operator-only，tool 拒绝。
- 当前 Codex host session 的模型/effort 用内置 `/model`。
- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。
- invalid config 的 status 返回 error/raw tiers；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。
- schema=1 继续拒绝 `claude-implement`；schema=2 还要求 catalog 中真实存在 `claude_implement`。
