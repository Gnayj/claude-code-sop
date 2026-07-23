import type { ProviderKind, ReviewStage } from "../types.js";
import type { ResolvedConfig } from "../config.js";
import type { CodexClient } from "../codex-client.js";
import type { ClaudeClient } from "../claude-client.js";
import type { ReviewProvider } from "../review-provider.js";
export interface ProviderFactoryDeps {
    config: ResolvedConfig;
    /** Repo root the backend operates within (= resolveProjectPath(config, baseDir, ".")). */
    workingDirectory: string;
    /** Resolved default sessions dir (paths.sessions_dir) — manual prompt/verdict files. */
    sessionsDir: string;
    /** Injectable clients (tests pass mocks; server passes the real SDK-backed clients). */
    codexClient?: CodexClient;
    claudeClient?: ClaudeClient;
    /** Construct a specific backend instead of config.review.provider — used by the per-stage
     * flow-matrix derivation (collaboration.md §1.D); the config's provider tuning subtables
     * ([review.codex] / [review.claude] / [review.manual]) still apply. */
    kindOverride?: ProviderKind;
}
/** The §1.D heterogeneous-review invariant: a stage's reviewer is the other model. */
export declare function counterpartOf(owner: "claude" | "codex"): ProviderKind;
/**
 * Per-stage reviewer derivation (collaboration.md §1.D, design ccsop-flow-matrix).
 *
 * - `review.provider = manual` short-circuits EVERY stage to manual delivery.
 * - Both `[collaboration]` owner keys absent → legacy mode: `review.provider` governs all
 *   stages exactly as before the flow axis existed (c_legacy_owner_presence — presence is
 *   observable because the schema gives the keys no default).
 * - Otherwise: design → counterpart(design_owner ?? "claude"); code → counterpart(
 *   implement_owner ?? "claude"). The fix stage normally INHERITS the persisted session's
 *   provider_kind (the reviewer who raised the findings re-judges the fix) — that resolution
 *   needs the session state and lives in run-review-flow; this function's "fix" answer is the
 *   no-session fallback and mirrors the code stage.
 */
export declare function providerKindForStage(stage: ReviewStage, config: ResolvedConfig): ProviderKind;
export declare function createReviewProvider(deps: ProviderFactoryDeps): ReviewProvider;
//# sourceMappingURL=factory.d.ts.map