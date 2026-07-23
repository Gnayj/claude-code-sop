import type { CodexEffort, ResolvedConfig } from "./config.js";
import { ImplementStore, type FileChangeFact, buildWriterEnvironment } from "./implement-workspace.js";
export interface WriterTurnRequest {
    scratchRoot: string;
    prompt: string;
    /** Full replacement env (isolated CODEX_HOME + neutralized git) for the writer CLI. */
    env: Record<string, string>;
    /** CLI `--config` overrides (sandbox tmp exclusions — Q19 defense in depth). */
    cliConfigOverrides?: Record<string, unknown>;
    model?: string;
    effort?: CodexEffort;
    /** Cancellation — MUST be forwarded into the SDK turn (TurnOptions.signal; design §4.4). */
    signal?: AbortSignal;
}
export interface WriterTurnResult {
    text: string;
    /** The (fresh) thread id this turn ran under — recorded per dispatch for audit (Q16). */
    threadId?: string;
    /** Total token estimate for the turn (accounting). */
    tokensTotal?: number;
}
/** Injectable writer boundary: production wraps OpenAICodexClient (tier "implement", fresh
 * thread per dispatch — Q16); tests substitute a scripted writer editing the scratch. */
export type RunWriterTurn = (req: WriterTurnRequest) => Promise<WriterTurnResult>;
export interface ImplementFlowDependencies {
    config: ResolvedConfig;
    configBaseDir: string;
    store: ImplementStore;
    runWriterTurn: RunWriterTurn;
    /** Test seam for the Q19 attestation gate (defaults to the real builder). */
    buildWriterEnv?: typeof buildWriterEnvironment;
}
export interface ImplementFlowInput {
    designId: string;
    taskCardPath: string;
    filesAllowlist: string[];
    workOrder: string;
    dispatchKey: string;
    previousFindings?: unknown;
    /** MCP cancellation signal — propagated into lock waits, the SDK turn, and the diff budget. */
    signal?: AbortSignal;
}
export interface ImplementFlowResult {
    ok: boolean;
    replayed?: boolean;
    dispatch_summary?: string;
    patch_path?: string;
    report_path?: string;
    files_changed?: FileChangeFact[];
    diffstat?: {
        files: number;
        added: number;
        removed: number;
    };
    /** Advisory (schema-validated) self report; null with raw_excerpt on parse failure. */
    self_report?: unknown;
    self_report_raw_excerpt?: string;
    violations?: string[];
    error?: string;
    round?: number;
    lifecycle?: string;
    session?: {
        rounds_used: number;
        rounds_max: number;
        codex_failure_streak: number;
        parser_failure_streak: number;
    };
}
/** Lenient extraction of the last balanced top-level JSON object in the writer text. */
export declare function extractLastJsonObject(text: string): unknown;
export declare function runImplementFlow(deps: ImplementFlowDependencies, input: ImplementFlowInput): Promise<ImplementFlowResult>;
//# sourceMappingURL=run-implement-flow.d.ts.map