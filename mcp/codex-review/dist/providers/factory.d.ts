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
}
export declare function createReviewProvider(deps: ProviderFactoryDeps): ReviewProvider;
//# sourceMappingURL=factory.d.ts.map