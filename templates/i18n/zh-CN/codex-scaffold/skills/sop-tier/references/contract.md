# ccsop tier contract v1

- `claude-review` → `[review.claude] backend/model/effort`。
- `codex-review` → `[review.codex] model/effort`。
- `codex-dispatch` → `[implement] model/effort`（只控制 `codex_implement`）。
- `codex-default` → `[codex] default_model/default_effort`。
- 当前 Codex host session 的模型/effort 用内置 `/model`。
- 空参和隐式触发只读；显式 set 必须调用 `ccsop_configure`。
- invalid config 的 status 返回 error/raw tiers；显式 set 仅在 whole-config 校验通过时修目标键，否则零写。
- Phase 1 不接受未发布的 implement scope。
