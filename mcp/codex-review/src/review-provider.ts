// ReviewProvider abstraction — the "raw turn" boundary (design §4.7, Q2/Q5/Q7/Q10).
//
// A ReviewProvider knows ONLY how to obtain one raw turn of review text (+ usage +
// a resumable session handle). It does NOT parse, does NOT decide verdicts, does NOT
// own orchestration state. The orchestrator (run-review-flow) keeps: output-parser,
// server-authoritative review_id/thread_id override, usage accounting, context_usage_pct
// / force_new_thread decisions, drift, circuit-breakers, envelope assembly + schema check.
//
// Provider boundary = raw turn, NOT a parsed envelope (codex r1 C1). Manual two-phase
// (codex r2 C2): a `runTurn` may return `awaiting_manual` instead of a turn — that branch
// is a CONTROL result the orchestrator returns as-is, never fed to the parser/breaker/usage.

import type { ReviewStage, ProviderKind } from "./types.js";

/** Which backend produces the review turn (single source: types.ts ProviderKindSchema). */
export type { ProviderKind };

/** Review stage the session is scoped to (alias kept for design §4.7 `ReviewKind`). */
export type ReviewKind = ReviewStage;

/**
 * A fully-rendered review prompt handed to a provider. The orchestrator owns rendering
 * (drift preface + cold-start preface + template body); the provider only transmits `text`.
 */
export interface RenderedReviewPrompt {
  text: string;
  /** Repo root the review backend operates within (read-only for codex). */
  workingDirectory: string;
  designId: string;
  stage: ReviewStage;
  /** The round this review will record (currentRound+1). Used by manual for file naming. */
  round: number;
  /** Manual two-phase submit: path to a human-pasted verdict.json. When set and readable,
   * ManualProvider ingests it as a turn instead of preparing a new prompt. */
  manualVerdictPath?: string;
}

/**
 * Persisted cross-turn session, keyed per design_id × stage by the orchestrator's
 * ThreadState. Survives MCP restarts. `context_usage_source` records whether
 * context_usage_pct is the backend's native report (codex) or an estimate (claude).
 */
export interface PersistedProviderSession {
  provider_kind: ProviderKind;
  /** codex = thread_id; claude = message-history handle/path; manual = "". */
  external_session_id: string;
  context_usage_source: "native" | "estimated";
  created_at: string;
}

/** Live, in-flight session handle returned by openSession and passed to runTurn. */
export interface ProviderSession {
  kind: ProviderKind;
  designId: string;
  stage: ReviewStage;
  /**
   * Resumable external id. "" for a fresh codex thread until the first runTurn populates it
   * (SDK Thread.id is null pre-run). runTurn returns the authoritative id via provider_session_id.
   */
  externalSessionId: string;
  /** Provider-internal runtime handle (e.g. codex ThreadHandle). Opaque to the orchestrator. */
  handle?: unknown;
}

export interface ProviderUsage {
  input: number | null;
  output: number | null;
  total: number | null;
  /**
   * Backend-reported context fraction when the provider can measure it cheaply. Codex reports
   * context_usage_pct inside the envelope text (parsed by the orchestrator, NOT here), so codex
   * leaves this undefined. Claude estimates from cumulative tokens / model limit (slice 3).
   */
  context_usage_pct?: number;
}

/**
 * Discriminated union (codex r2 C2): only `kind:"turn"` flows into output-parser / envelope /
 * breaker / usage accounting. `kind:"awaiting_manual"` is a control branch the orchestrator
 * returns verbatim (MCP replies "awaiting"); the submit phase re-enters with the verdict.
 * codex / claude ALWAYS return `kind:"turn"` (Q10).
 */
export type ProviderRunResult =
  | {
      kind: "turn";
      /** Raw assistant turn text — the orchestrator parses this into an envelope. */
      text: string;
      usage: ProviderUsage;
      /** Authoritative resumable session id after this turn (codex=thread_id / claude=history handle). */
      provider_session_id: string;
    }
  | {
      kind: "awaiting_manual";
      /** Where the provider wrote the prompt for a human/external reviewer. */
      prompt_path: string;
      /** Where the orchestrator expects the human-pasted verdict on the submit call. */
      verdict_path_expected: string;
    };

export interface ReviewProvider {
  readonly kind: ProviderKind;

  /**
   * Open (or resume) a session for design_id × stage. If `prior` is supplied AND its
   * provider_kind matches, the provider resumes that external session; otherwise it starts
   * fresh. The orchestrator decides whether to pass `prior` (it omits it to force a new
   * session on context-rebuild, caller force_new_thread, or provider switch — Q7).
   */
  openSession(
    stage: ReviewStage,
    designId: string,
    prior?: PersistedProviderSession,
  ): Promise<ProviderSession>;

  /** Run exactly one review turn. May return a turn OR an awaiting_manual control result. */
  runTurn(
    input: RenderedReviewPrompt,
    session: ProviderSession,
  ): Promise<ProviderRunResult>;

  /** Release any provider-held resources for the session. Persisted state is the orchestrator's. */
  closeSession(session: ProviderSession): void;
}
