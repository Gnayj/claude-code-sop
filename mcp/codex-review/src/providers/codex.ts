// CodexProvider — the default review provider (design §4.7, Q5).
//
// Wraps the existing CodexClient (codex-client.ts) behind the ReviewProvider raw-turn
// interface with BEHAVIOR 1:1 EQUIVALENT to the pre-abstraction direct-codex path
// (§8.3): thread reuse via resumeThread, fresh thread via startThread, and the same
// error boundary — start/resume happens in openSession (errors propagate like the old
// flow's startThread/resumeThread), the turn happens in runTurn (errors hit the
// codex-failure breaker exactly as before). context_usage_pct stays orchestrator-owned
// (parsed from the codex envelope), so this provider leaves usage.context_usage_pct unset.

import type { CodexClient, ThreadHandle } from "../codex-client.js";
import type {
  ProviderSession,
  ProviderRunResult,
  RenderedReviewPrompt,
  ReviewProvider,
  PersistedProviderSession,
} from "../review-provider.js";
import type { ReviewStage } from "../types.js";

export interface CodexProviderOptions {
  /** Repo root the codex agent operates within (read-only). Constant per server. */
  workingDirectory: string;
  /** Optional model id; "" / undefined = SDK default. */
  model?: string;
}

export class CodexProvider implements ReviewProvider {
  readonly kind = "codex" as const;

  constructor(
    private readonly codex: CodexClient,
    private readonly opts: CodexProviderOptions,
  ) {}

  async openSession(
    stage: ReviewStage,
    designId: string,
    prior?: PersistedProviderSession,
  ): Promise<ProviderSession> {
    const canResume =
      prior !== undefined &&
      prior.provider_kind === "codex" &&
      prior.external_session_id.length > 0;
    if (canResume) {
      const handle = await this.codex.resumeThread(prior!.external_session_id);
      return {
        kind: "codex",
        designId,
        stage,
        externalSessionId: prior!.external_session_id,
        handle,
      };
    }
    const handle = await this.codex.startThread({
      workingDirectory: this.opts.workingDirectory,
      model: this.opts.model,
    });
    // Fresh thread: SDK Thread.id is null until the first run; "" until runTurn populates it.
    return { kind: "codex", designId, stage, externalSessionId: "", handle };
  }

  async runTurn(
    input: RenderedReviewPrompt,
    session: ProviderSession,
  ): Promise<ProviderRunResult> {
    const handle = session.handle as ThreadHandle;
    const result = await handle.runTurn(input.text);
    return {
      kind: "turn",
      text: result.text,
      usage: {
        input: result.usage?.inputTokens ?? null,
        output: result.usage?.outputTokens ?? null,
        total: result.usage?.totalTokens ?? null,
        // context_usage_pct intentionally omitted: codex reports it inside the envelope
        // text, which the orchestrator parses. Keeping it here would double-source it.
      },
      provider_session_id: handle.threadId,
    };
  }

  closeSession(_session: ProviderSession): void {
    // @openai/codex-sdk has no explicit close; thread is reclaimed by the SDK/runtime.
  }
}
