// codex_implement proposal-mode flow (design ccsop-codex-implement §4.1 / §4.2; v2 chain r1–r7).
//
// One dispatch = one work order: identity → durable RESERVE (first per-dispatch filesystem
// effect — §4.2.E reserve-first) → derived resource allocation → typed snapshot + pre-spawn
// topology pass (r7) → attested writer spawn (fresh thread, Q16; sandbox tmp exclusions, Q19)
// → sealed capture → validation (Q9 end-state deltas + both-sides text gate + opaque-root
// baseline semantics) → GITLESS bounded patch generation (Q18) → artifact publication (store
// lock under strict design→store order) → durable completed record. The tool NEVER writes the
// caller repository outside `.codex-review/` and NEVER applies the patch (the driver does,
// after §9 review). Cancellation propagates into lock waits, the SDK turn (TurnOptions.signal),
// and the diff budget; a cancelled dispatch terminalizes `failed (cancelled)` and publishes
// nothing.

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

import type {
  ClaudeEffort,
  CodexEffort,
  ResolvedConfig,
} from "./config.js";
import { resolveCodexTier, resolveProjectPath } from "./config.js";
import {
  canonicalSetsEqual,
  parseAllowlist,
  parseFilesBlockFromCard,
} from "./allowlist.js";
import {
  ImplementStore,
  PROCESS_EPOCH_STARTED_AT,
  PROCESS_EPOCH_START_TOKEN,
  getDispatch,
  type DispatchRecord,
  type FileChangeFact,
  type ImplementWriterKind,
  type PublishedArtifact,
  allocateDispatchResources,
  BlobStore,
  buildSnapshot,
  buildWriterEnvironment,
  computePayloadSha,
  discardDispatchResources,
  ensureFlockSupport,
  generatePatch,
  materializeScratch,
  newArtifactId,
  publishArtifact,
  sealCapture,
  sha256,
  validateCapture,
  validateDispatchKey,
} from "./implement-workspace.js";
import {
  LockCancelledError,
  LockTimeoutError,
  acquisitionDeadline,
} from "./locks.js";
import {
  ImplementLedger,
  type LedgerReservation,
} from "./implement-ledger.js";
import {
  validateClaudeProposal,
  type ClaudeProposalValidation,
} from "./implement-sandbox.js";

export interface WriterTurnRequest {
  scratchRoot: string;
  /** Server-private per-dispatch home, sibling of scratch. */
  privateHome?: string;
  prompt: string;
  /** Full replacement env (isolated CODEX_HOME + neutralized git) for the writer CLI. */
  env: Record<string, string>;
  /** CLI `--config` overrides (sandbox tmp exclusions — Q19 defense in depth). */
  cliConfigOverrides?: Record<string, unknown>;
  model?: string;
  effort?: CodexEffort | ClaudeEffort;
  /** Cancellation — MUST be forwarded into the SDK turn (TurnOptions.signal; design §4.4). */
  signal?: AbortSignal;
}

export interface WriterTurnResult {
  text: string;
  /** The (fresh) thread id this turn ran under — recorded per dispatch for audit (Q16). */
  threadId?: string;
  /** Total token estimate for the turn (accounting). */
  tokensTotal?: number;
  /** Provider-specific, server-derived execution provenance. */
  writerAttestation?: Record<string, unknown>;
  warnings?: string[];
  wallSeconds?: number;
  costUsd?: number;
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
  /** The writer adapter sharing this provider-neutral proposal transaction. */
  writerKind?: ImplementWriterKind;
  /** Runtime config bytes used to build this dependency snapshot. */
  configPath?: string;
  configSha256?: string;
}

export interface ImplementFlowInput {
  designId: string;
  taskCardPath: string;
  /** Required by claude_implement; exact bytes are verified before reserve. */
  taskCardSha256?: string;
  filesAllowlist: string[];
  workOrder: string;
  dispatchKey: string;
  previousFindings?: unknown;
  /** MCP cancellation signal — propagated into lock waits, the SDK turn, and the diff budget. */
  signal?: AbortSignal;
}

/** Advisory self-report schema (design §4.4 implement_report). */
const SelfReportSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()).optional(),
  tests_run: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export interface ImplementFlowResult {
  ok: boolean;
  replayed?: boolean;
  dispatch_summary?: string;
  patch_path?: string;
  report_path?: string;
  files_changed?: FileChangeFact[];
  diffstat?: { files: number; added: number; removed: number };
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
  writer_kind?: ImplementWriterKind;
  patch_sha256?: string;
  applicability?: "applicable" | "advisory-only";
  apply_policy?: "normal-confirmation" | "advisory-opt-in" | "export-only";
  warnings?: string[];
  validation?: ClaudeProposalValidation;
}

/** Built-in prompt fallback; a consumer-seeded `.codex-review/templates/implement.md.tpl`
 * (design §4.4) overrides it when present. */
const BUILTIN_PROMPT = `# ccsop implement dispatch (proposal mode)

You are the IMPLEMENTER for one bounded work order inside an isolated scratch workspace.
The driving session designed this task and will review your diff; you write code, nothing else.

HARD RULES (violations reject the whole dispatch — nothing you did will be kept):
1. Touch ONLY the files listed under FILES below (create/modify/delete exactly there).
2. Do NOT create any other file — no temp files, no build artifacts, no notes.
3. Do NOT run git commit / branch / tag / push. Do not touch .git.
4. Text files only; keep each file under the stated byte limit.
5. When done, output a single JSON object:
   {"summary": "...", "files": ["..."], "tests_run": ["..."], "risks": ["..."], "notes": "..."}

TASK CARD (the contract for this dispatch):
{{task_card}}

WORK ORDER (this dispatch):
{{work_order}}

FILES (the complete allowlist):
{{files}}

PREVIOUS FINDINGS to address (if any):
{{previous_findings}}

Byte limit per file: {{max_file_bytes}}.
Work in the current directory. It is a git checkout; you may read anything, but write only FILES.`;

function renderPrompt(
  config: ResolvedConfig,
  baseDir: string,
  vars: Record<string, string>,
): string {
  let template = BUILTIN_PROMPT;
  try {
    template = readFileSync(
      resolveProjectPath(config, baseDir, ".codex-review/templates/implement.md.tpl"),
      "utf8",
    );
  } catch {
    /* fall back to the built-in prompt */
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Lenient extraction of the last balanced top-level JSON object in the writer text. */
export function extractLastJsonObject(text: string): unknown {
  for (let start = text.lastIndexOf("{"); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
    if (start === 0) break;
  }
  return null;
}

function readActiveTaskCard(
  config: ResolvedConfig,
  configBaseDir: string,
  repoRoot: string,
  taskCardPath: string,
): { text: string; sha256: string } {
  const parsedPath = parseAllowlist([taskCardPath]);
  if (!parsedPath.ok || parsedPath.canonical[0] !== taskCardPath) {
    throw new Error("task_card_path must be a repo-relative POSIX path");
  }
  const cardPath = resolve(repoRoot, taskCardPath);
  const activeRoot = resolveProjectPath(
    config,
    configBaseDir,
    config.paths.plans_active,
  );
  const rel = relative(activeRoot, cardPath);
  if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(
      `task_card_path must name a file below ${config.paths.plans_active}`,
    );
  }
  let cursor = repoRoot;
  for (const segment of relative(repoRoot, cardPath).split("/")) {
    cursor = resolve(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`task card path must not contain symlinks: ${taskCardPath}`);
    }
  }
  const stat = lstatSync(cardPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`task card must be a regular non-symlink file: ${taskCardPath}`);
  }
  if (realpathSync(cardPath) !== cardPath) {
    throw new Error(`task card canonical path mismatch: ${taskCardPath}`);
  }
  const text = readFileSync(cardPath, "utf8");
  return { text, sha256: sha256(Buffer.from(text, "utf8")) };
}

const CLAUDE_SECRET_FILE =
  /^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials?(?:\.[^/]+)?|id_(?:rsa|dsa|ecdsa|ed25519)|secrets?(?:\.[^/]+)?|[^/]*\.(?:pem|key|p12|pfx|jks|keystore))$/i;
const CLAUDE_SECRET_DIRS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".docker",
  ".kube",
]);

function claudeSecretPath(path: string): boolean {
  const segments = path.split("/");
  const base = segments.at(-1) ?? "";
  if (/^\.env(?:\.|$)/i.test(base)) {
    return !/^\.env\.(?:example|sample|template)$/i.test(base);
  }
  return (
    segments.some((segment) => CLAUDE_SECRET_DIRS.has(segment.toLowerCase())) ||
    CLAUDE_SECRET_FILE.test(base)
  );
}

function claudeAllowlistError(
  paths: readonly string[],
  authorityPaths: {
    taskCardPath: string;
    handoffPath: string;
    designRoot: string;
    recordsRoot: string;
  },
): string | undefined {
  if (paths.length > 256) {
    return `claude_implement files_allowlist exceeds the 256-path hard cap (${paths.length})`;
  }
  const authorityPath = paths.find(
    (path) =>
      path === authorityPaths.taskCardPath ||
      path === authorityPaths.handoffPath ||
      equalOrBelow(path, authorityPaths.designRoot) ||
      (authorityPaths.recordsRoot !== "." &&
        equalOrBelow(path, authorityPaths.recordsRoot)),
  );
  if (authorityPath) {
    return `claude_implement authority path is hard-denied: ${JSON.stringify(authorityPath)}`;
  }
  const denied = paths.find(claudeSecretPath);
  return denied
    ? `claude_implement hard secret denylist rejects ${JSON.stringify(denied)}`
    : undefined;
}

function claudeScratchExcluded(path: string): boolean {
  const segments = path.split("/");
  if (
    [".codex-review", ".claude", ".agents", ".codex"].includes(
      segments[0] ?? "",
    )
  ) {
    return true;
  }
  if (
    segments.some((segment) =>
      [
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
      ].includes(segment),
    )
  ) {
    return true;
  }
  return claudeSecretPath(path);
}

function claudeSnapshotExcluded(path: string): boolean {
  return path === ".codex-review" || path.startsWith(".codex-review/");
}

function equalOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function repoRelativePath(repoRoot: string, absolutePath: string): string {
  const rel = relative(repoRoot, absolutePath).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`configured authority path is outside the repository: ${absolutePath}`);
  }
  return rel;
}

function snapshotInventorySha(snapshot: {
  inventory: Map<string, unknown>;
  opaqueRoots: Set<string>;
}): string {
  const facts = [...snapshot.inventory.entries()].sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  return sha256(
    Buffer.from(
      JSON.stringify({
        inventory: facts,
        opaque_roots: [...snapshot.opaqueRoots].sort(),
      }),
      "utf8",
    ),
  );
}

export async function runImplementFlow(
  deps: ImplementFlowDependencies,
  input: ImplementFlowInput,
): Promise<ImplementFlowResult> {
  const { config, configBaseDir, store, runWriterTurn } = deps;
  const writerKind = deps.writerKind ?? "codex";

  // ---------- 0) gates + identity (nothing persisted is touched yet) ----------
  const explicitOwners =
    config.collaboration.design_owner !== undefined ||
    config.collaboration.implement_owner !== undefined;
  if (writerKind === "codex" && !config.implement.enabled) {
    return {
      ok: false,
      error:
        "codex_implement is disabled ([implement] enabled=false). Enable it in " +
        ".codex-review/config.toml only for the claude+codex preside flow (collaboration.md §1.D).",
    };
  }
  if (
    writerKind === "codex" &&
    explicitOwners &&
    config.collaboration.implement_owner !== "codex"
  ) {
    return {
      ok: false,
      error:
        "codex_implement requires implement_owner=codex when collaboration owners are explicit",
    };
  }
  if (writerKind === "claude") {
    const gateFailures = [
      config.meta.control_surface_schema === 2
        ? ""
        : "meta.control_surface_schema must be 2",
      config.collaboration.design_owner === "codex"
        ? ""
        : "design_owner must be codex",
      config.collaboration.implement_owner === "claude"
        ? ""
        : "implement_owner must be claude",
      config.implement.claude.enabled
        ? ""
        : "[implement.claude] enabled must be true (operator opt-in)",
      config.implement.claude.backend === "cli"
        ? ""
        : "only backend=cli is supported",
    ].filter(Boolean);
    if (gateFailures.length > 0) {
      return {
        ok: false,
        error: `claude_implement gate failed: ${gateFailures.join("; ")}`,
      };
    }
  }
  if (input.designId.endsWith(".implement")) {
    return { ok: false, error: "design_id must not end with '.implement' (reserved namespace suffix)" };
  }
  if (input.signal?.aborted) return { ok: false, error: "dispatch cancelled before start" };
  const keyError = validateDispatchKey(input.dispatchKey);
  if (keyError) return { ok: false, error: keyError };

  const inputList = parseAllowlist(input.filesAllowlist);
  if (!inputList.ok) {
    return { ok: false, error: `files_allowlist invalid:\n${inputList.errors.join("\n")}` };
  }
  const repoRoot = resolveProjectPath(config, configBaseDir, ".");
  let card: { text: string; sha256: string };
  try {
    if (writerKind === "claude") {
      card = readActiveTaskCard(
        config,
        configBaseDir,
        repoRoot,
        input.taskCardPath,
      );
      const handoffPath = repoRelativePath(
        repoRoot,
        resolveProjectPath(config, configBaseDir, config.paths.handoff),
      );
      const recordsRoot = dirname(handoffPath).replaceAll("\\", "/");
      const allowlistError = claudeAllowlistError(inputList.canonical, {
        taskCardPath: input.taskCardPath,
        handoffPath,
        designRoot: join(dirname(recordsRoot), "design").replaceAll("\\", "/"),
        recordsRoot,
      });
      if (allowlistError) return { ok: false, error: allowlistError };
    } else {
      const text = readFileSync(
        resolveProjectPath(config, configBaseDir, input.taskCardPath),
        "utf8",
      );
      card = { text, sha256: sha256(Buffer.from(text, "utf8")) };
    }
  } catch (err) {
    return { ok: false, error: `cannot read task card ${input.taskCardPath}: ${(err as Error).message}` };
  }
  const cardText = card.text;
  const cardSha = card.sha256;
  if (writerKind === "claude") {
    if (!input.taskCardSha256) {
      return {
        ok: false,
        error: "claude_implement requires task_card_sha256",
      };
    }
    if (input.taskCardSha256 !== cardSha) {
      return {
        ok: false,
        error:
          `task card sha mismatch: expected=${input.taskCardSha256} actual=${cardSha}`,
      };
    }
  }
  const cardList = parseFilesBlockFromCard(cardText);
  if (!cardList.ok) {
    return { ok: false, error: `task card \`\`\`files block invalid:\n${cardList.errors.join("\n")}` };
  }
  if (!canonicalSetsEqual(inputList.canonical, cardList.canonical)) {
    return {
      ok: false,
      error:
        "files_allowlist does not equal the task card ```files block (canonical set mismatch). " +
        `input=[${inputList.canonical.join(", ")}] card=[${cardList.canonical.join(", ")}]`,
    };
  }
  const allowlist = inputList.canonical;
  const payloadSha = computePayloadSha({
    workOrder: input.workOrder,
    canonicalAllowlist: allowlist,
    cardSha,
    previousFindings: input.previousFindings,
    writerKind,
  });
  const legacyPayloadSha = computePayloadSha({
    workOrder: input.workOrder,
    canonicalAllowlist: allowlist,
    cardSha,
    previousFindings: input.previousFindings,
  });

  // Q17/§4.2.F: control-plane bootstrap + platform capability probe (once per process;
  // idempotent, dispatch-independent — exempt from reserve-first).
  try {
    ensureFlockSupport(repoRoot);
  } catch (err) {
    return { ok: false, error: `control-state unavailable: ${(err as Error).message}` };
  }

  // ---------- 1) per-design transaction lock (kernel flock; ONE acquisition deadline for the
  // entry episode: design lock + recovery's store acquisition — design r7) ----------
  const lockTimeoutMs = config.state.lock_timeout_seconds * 1000;
  const entryDeadline = acquisitionDeadline(lockTimeoutMs);
  let designLock;
  try {
    designLock = await store.lock(input.designId, entryDeadline, input.signal);
  } catch (err) {
    // Control-root violation / flock unavailable / timeout / cancel — nothing was written.
    return { ok: false, error: `control-state unavailable: ${(err as Error).message}` };
  }
  try {
    // ---------- 2) recovery + object-class GC + idempotency lookup (before round allocation) ----------
    let state;
    try {
      state =
        (await store.recoverAndGc(input.designId, entryDeadline, input.signal)) ??
        store.newState(input.designId, writerKind);
    } catch (err) {
      return { ok: false, error: `control-state unavailable: ${(err as Error).message}` };
    }
    const stateWriterKind = state.writer_kind ?? "codex";
    if (stateWriterKind !== writerKind) {
      return {
        ok: false,
        error:
          `design_id ${input.designId} is already owned by writer_kind=${stateWriterKind}; ` +
          `cross-writer reuse as ${writerKind} is prohibited`,
      };
    }
    const legacyState = state.schema_version === undefined;
    if (legacyState && writerKind !== "codex") {
      return {
        ok: false,
        error: "legacy implement state can only be migrated as writer_kind=codex",
      };
    }
    const sessionFacts = () => ({
      rounds_used: state.rounds,
      rounds_max: config.implement.max_implement_rounds,
      codex_failure_streak: state.codex_failure_streak,
      parser_failure_streak: state.parser_failure_streak,
    });
    const existing = getDispatch(state, input.dispatchKey);
    if (existing) {
      const existingKind = existing.writer_kind ?? "codex";
      if (existingKind !== writerKind) {
        return {
          ok: false,
          error:
            `dispatch_key belongs to writer_kind=${existingKind}; cross-writer replay is prohibited`,
          session: sessionFacts(),
        };
      }
      const expectedPayload =
        existing.payload_schema_version === 2 ? payloadSha : legacyPayloadSha;
      if (existing.payload_sha !== expectedPayload) {
        return {
          ok: false,
          error: `dispatch_key reuse with a DIFFERENT payload (recorded round ${existing.round}); use a fresh key for a new dispatch`,
          session: sessionFacts(),
        };
      }
      if (existing.lifecycle === "completed") {
        const verified = verifyArtifacts(repoRoot, existing);
        if (!verified.ok) {
          return { ok: false, error: `replay verification failed: ${verified.error}`, session: sessionFacts() };
        }
        return { ...(existing.result as ImplementFlowResult), replayed: true };
      }
      if (existing.lifecycle === "failed") {
        const prior = existing.result as ImplementFlowResult | undefined;
        if (prior) return { ...prior, replayed: true };
        return {
          ok: false,
          error: existing.failure_reason ?? "dispatch failed (no recorded result)",
          round: existing.round,
          lifecycle: "failed",
          replayed: true,
          session: sessionFacts(),
        };
      }
      // reserved/executing with a LIVE epoch while we hold the design lock: same-key concurrent
      // call raced our lock release, or a crashed same-pid predecessor — report in-progress.
      return {
        ok: false,
        error: `dispatch ${input.dispatchKey} is still in progress (lifecycle=${existing.lifecycle})`,
        session: sessionFacts(),
      };
    }

    // ---------- 3) round pre-check + DURABLE RESERVE (first per-dispatch filesystem effect —
    // §4.2.E reserve-first: every resource path is a pure function of the artifact-id and is
    // allocated only after this record is durable) ----------
    if (state.rounds >= config.implement.max_implement_rounds) {
      return {
        ok: false,
        error:
          `max_implement_rounds (${config.implement.max_implement_rounds}) reached for ` +
          `${input.designId} — circuit breaker; escalate to the user per §9.E.`,
        session: sessionFacts(),
      };
    }
    const round = state.rounds + 1;
    const record: DispatchRecord = {
      writer_kind: writerKind,
      payload_schema_version: 2,
      dispatch_key: input.dispatchKey,
      payload_sha: payloadSha,
      artifact_id: newArtifactId(),
      round,
      lifecycle: "reserved",
      epoch_pid: process.pid,
      epoch_started_at: PROCESS_EPOCH_STARTED_AT,
      ...(PROCESS_EPOCH_START_TOKEN != null ? { epoch_start_token: PROCESS_EPOCH_START_TOKEN } : {}),
    };
    if (legacyState) store.archiveLegacyState(state);
    state.dispatches.push(record);
    state.schema_version = 2;
    state.writer_kind = writerKind;
    state.dispatch_count_total = (state.dispatch_count_total ?? 0) + 1;
    // The reserved round is consumed durably NOW (breaker honesty across crashes).
    state.rounds = round;
    store.write(state);

    let ledger: ImplementLedger | undefined;
    let ledgerReservation: LedgerReservation | undefined;
    if (writerKind === "claude") {
      ledger = new ImplementLedger(repoRoot);
      try {
        ledgerReservation = await ledger.reserve({
          designId: input.designId,
          artifactId: record.artifact_id,
          writerKind,
          config: config.implement.claude,
          allowCreate: state.dispatches.length === 1,
          lockTimeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (err) {
        const failed: ImplementFlowResult = {
          ok: false,
          error: `Claude implement budget reservation failed: ${(err as Error).message}`,
          round,
          lifecycle: "failed",
        };
        record.lifecycle = "failed";
        record.failure_reason = failed.error;
        record.result = failed;
        store.write(state);
        return failed;
      }
    }

    const finishFailed = (result: ImplementFlowResult): ImplementFlowResult => {
      record.lifecycle = "failed";
      record.failure_reason = result.error ?? (result.violations ?? []).join("; ");
      const final = { ...result, round, lifecycle: "failed" as const, session: sessionFacts() };
      record.result = final;
      store.write(state);
      return final;
    };
    const cancelledResult = (stageNote: string): ImplementFlowResult => ({
      ok: false,
      error: `dispatch cancelled ${stageNote}; nothing published`,
    });

    try {
      // ---------- 4) ONE terminalizing envelope for every post-reserve phase ----------
      try {
        const resources = allocateDispatchResources(repoRoot, record.artifact_id);
        const snapshotStore = new BlobStore(resources.snapBlobs);
        const captureStore = new BlobStore(resources.capBlobs);

        // Writer environment + attestation gate (Q11 + Q19): a constructed config missing
        // either tmp exclusion hard-fails BEFORE the writer spawns.
        const codexTier =
          writerKind === "codex"
            ? resolveCodexTier(config, "implement")
            : undefined;
        const writerModel =
          writerKind === "codex"
            ? codexTier?.model
            : config.implement.claude.model;
        const writerEffort =
          writerKind === "codex"
            ? codexTier?.effort
            : config.implement.claude.effort || undefined;
        const writerEnv =
          writerKind === "codex"
            ? (deps.buildWriterEnv ?? buildWriterEnvironment)(
                resources.home,
                writerModel,
                writerEffort as CodexEffort | undefined,
              )
            : {
                env: {} as Record<string, string>,
                cliConfigOverrides: undefined,
                attestation: {
                  writer_kind: "claude",
                  isolation: "delegated-to-claude-implement-adapter",
                },
              };
        if (
          writerKind === "codex" &&
          (!("excludeSlashTmp" in writerEnv.attestation) ||
            !writerEnv.attestation.excludeSlashTmp ||
            !writerEnv.attestation.excludeTmpdirEnvVar)
        ) {
          return finishFailed({
            ok: false,
            error:
              "writer sandbox attestation failed: constructed config is missing " +
              "sandbox_workspace_write tmp exclusions (Q19); dispatch refused pre-spawn",
          });
        }

        // Typed snapshot + pre-spawn topology pass (r7): unmerged stages / opaque-root
        // allowlist entries reject BEFORE the writer spawns.
        const snapResult = buildSnapshot(
          repoRoot,
          allowlist,
          snapshotStore,
          writerKind === "claude"
            ? { excludePath: claudeSnapshotExcluded }
            : undefined,
        );
        if (snapResult.rejections.length > 0) {
          return finishFailed({
            ok: false,
            violations: snapResult.rejections.map((r) => r.reason),
            error: `dispatch rejected pre-spawn (topology): ${snapResult.rejections.length} problem(s)`,
          });
        }
        const snapshot = snapResult.snapshot;
        const callerPreimageSha = snapshotInventorySha(snapshot);
        const scratch = materializeScratch(
          snapshot,
          resources.scratch,
          writerKind === "claude"
            ? { excludePath: claudeScratchExcluded }
            : undefined,
        );
        record.lifecycle = "executing";
        store.write(state);

        const prompt = renderPrompt(config, configBaseDir, {
          task_card: cardText,
          work_order: input.workOrder,
          files: allowlist.join("\n"),
          previous_findings: input.previousFindings
            ? JSON.stringify(input.previousFindings, null, 2)
            : "(none)",
          max_file_bytes: String(config.implement.max_file_bytes),
        });

        // ---------- 5) writer turn (FRESH thread per dispatch — Q16; signal forwarded into
        // the SDK turn — TurnOptions.signal) ----------
        let turn: WriterTurnResult;
        try {
          turn = await runWriterTurn({
            scratchRoot: scratch.root,
            privateHome: resources.home,
            prompt,
            env: writerEnv.env,
            cliConfigOverrides: writerEnv.cliConfigOverrides,
            model: writerModel,
            effort: writerEffort,
            signal: input.signal,
          });
          state.codex_failure_streak = 0;
        } catch (err) {
          if (ledger && ledgerReservation) {
            try {
              await ledger.settle(
                ledgerReservation,
                {
                  wallSeconds: config.implement.claude.timeout_seconds,
                  budgetUsd: config.implement.claude.max_budget_usd,
                },
                lockTimeoutMs,
              );
              state.wall_seconds_total =
                (state.wall_seconds_total ?? 0) +
                config.implement.claude.timeout_seconds;
              state.budget_usd_total =
                (state.budget_usd_total ?? 0) +
                config.implement.claude.max_budget_usd;
            } catch (ledgerError) {
              return finishFailed({
                ok: false,
                error:
                  `writer turn failed and budget settlement also failed: ` +
                  `${(err as Error).message}; ${(ledgerError as Error).message}`,
              });
            }
          }
          if (input.signal?.aborted) {
            return finishFailed(cancelledResult("during the writer turn"));
          }
          state.codex_failure_streak += 1;
          const streak = state.codex_failure_streak;
          const threshold = config.circuit_breakers.codex_failure_streak_threshold;
          return finishFailed({
            ok: false,
            error:
              `writer turn failed: ${(err as Error).message}` +
              (streak >= threshold
                ? ` [codex_unavailable breaker: ${streak} consecutive failures]`
                : ""),
          });
        }
        record.thread_id = turn.threadId ?? "";
        state.tokens_used_estimate_total += turn.tokensTotal ?? 0;
        if (ledger && ledgerReservation) {
          const wallSeconds = Math.min(
            turn.wallSeconds ?? config.implement.claude.timeout_seconds,
            config.implement.claude.timeout_seconds,
          );
          const costUsd = Math.min(
            turn.costUsd ?? config.implement.claude.max_budget_usd,
            config.implement.claude.max_budget_usd,
          );
          await ledger.settle(
            ledgerReservation,
            { wallSeconds, budgetUsd: costUsd },
            lockTimeoutMs,
            input.signal,
          );
          state.wall_seconds_total =
            (state.wall_seconds_total ?? 0) + wallSeconds;
          state.budget_usd_total =
            (state.budget_usd_total ?? 0) + costUsd;
        }
        store.write(state);
        if (input.signal?.aborted) {
          return finishFailed(cancelledResult("after the writer turn"));
        }

        // The writer namespace cannot see the caller repo, but an external concurrent actor can.
        // Re-inventory before artifact publication so a stale/mutated caller preimage fails closed.
        if (writerKind === "claude") {
          const integrityBlobDir = join(resources.base, "integrity-blobs");
          mkdirSync(integrityBlobDir, { mode: 0o700 });
          const callerAfter = buildSnapshot(
            repoRoot,
            allowlist,
            new BlobStore(integrityBlobDir),
            { excludePath: claudeSnapshotExcluded },
          );
          if (
            callerAfter.rejections.length > 0 ||
            snapshotInventorySha(callerAfter.snapshot) !== callerPreimageSha
          ) {
            return finishFailed({
              ok: false,
              error:
                "caller repository integrity changed during dispatch; proposal quarantined",
            });
          }
          if (
            deps.configPath &&
            deps.configSha256 &&
            sha256(readFileSync(deps.configPath)) !== deps.configSha256
          ) {
            return finishFailed({
              ok: false,
              error:
                "runtime config integrity changed during dispatch; proposal quarantined",
            });
          }
        }

        // ---------- 6) sealed capture + validation (opaque-root baseline semantics) ----------
        const capture = sealCapture(scratch.root, captureStore, snapshot.opaqueRoots);
        const validation = validateCapture(
          snapshot,
          capture,
          allowlist,
          config.implement.max_file_bytes,
        );
        if (!validation.ok) {
          return finishFailed({
            ok: false,
            violations: validation.violations,
            error: `dispatch rejected: ${validation.violations.length} violation(s); no patch emitted`,
          });
        }
        if (validation.deltas.length === 0) {
          return finishFailed({
            ok: false,
            error: "writer produced no changes (empty delta); no patch emitted",
          });
        }

        // ---------- 7) GITLESS bounded patch (Q18) + scope breaker ----------
        const generated = generatePatch(snapshot, capture, validation.deltas, {
          checkCancel: () => {
            if (input.signal?.aborted) throw new Error("cancelled during patch generation");
          },
        });
        const scopeLimit = config.circuit_breakers.scope_drift_lines_threshold;
        const diffLines = generated.diffstat.added + generated.diffstat.removed;
        if (diffLines > scopeLimit) {
          return finishFailed({
            ok: false,
            error:
              `scope breaker: ${diffLines} changed lines exceed ` +
              `scope_drift_lines_threshold=${scopeLimit}; dispatch discarded`,
          });
        }
        let proposalValidation: ClaudeProposalValidation | undefined;
        if (writerKind === "claude") {
          try {
            proposalValidation = await validateClaudeProposal({
              config: config.implement.claude,
              repoRoot,
              snapshot,
              deltas: validation.deltas,
              patch: generated.patch,
              validationRoot: join(resources.base, "validation"),
              ...(input.signal ? { signal: input.signal } : {}),
            });
          } catch (err) {
            proposalValidation = {
              status: "fail",
              applicability: "advisory-only",
              apply_policy: config.implement.claude.allow_advisory_apply
                ? "advisory-opt-in"
                : "export-only",
              reasons: [
                `server validation infrastructure failed: ${(err as Error).message}`,
              ],
              validation_affecting_changes: [],
              definition_preimage_sha256: "",
              dependency_mounts: [],
              commands: [],
              baseline_only: false,
            };
          }
        }
        const rawReport = extractLastJsonObject(turn.text);
        const parsedReport = SelfReportSchema.safeParse(rawReport);
        let selfReport: unknown = null;
        let rawExcerpt: string | undefined;
        if (parsedReport.success) {
          selfReport = parsedReport.data;
          state.parser_failure_streak = 0;
        } else {
          state.parser_failure_streak += 1;
          rawExcerpt = turn.text.slice(0, 2000);
        }
        if (input.signal?.aborted) {
          return finishFailed(cancelledResult("before publication"));
        }

        // ---------- 8) publish (fsync, store-locked under design→store order; fresh
        // acquisition deadline for this episode) THEN durable completed ----------
        const report = {
          schema_version: 2,
          design_id: input.designId,
          writer_kind: writerKind,
          round,
          artifact_id: record.artifact_id,
          files_changed: generated.filesChanged,
          diffstat: generated.diffstat,
          self_report: selfReport,
          writer_attestation: {
            ...writerEnv.attestation,
            ...(turn.writerAttestation ?? {}),
          },
          writer_thread_id: record.thread_id,
          warnings: turn.warnings ?? [],
          ...(proposalValidation
            ? {
                validation: proposalValidation,
                applicability: proposalValidation.applicability,
                apply_policy: proposalValidation.apply_policy,
              }
            : {}),
          generated_at: new Date().toISOString(),
        };
        let published: PublishedArtifact;
        try {
          published = await publishArtifact(
            repoRoot,
            record.artifact_id,
            generated.patch,
            report,
            acquisitionDeadline(lockTimeoutMs),
            input.signal,
          );
        } catch (err) {
          if (err instanceof LockTimeoutError) {
            return finishFailed({
              ok: false,
              error: `artifact publication failed (lock timeout): ${(err as Error).message}`,
            });
          }
          if (err instanceof LockCancelledError || input.signal?.aborted) {
            return finishFailed(cancelledResult("during publication"));
          }
          return finishFailed({
            ok: false,
            error: `artifact publication failed: ${(err as Error).message}`,
          });
        }
        const result: ImplementFlowResult = {
          ok: true,
          writer_kind: writerKind,
          dispatch_summary:
            `round ${round}: ${generated.diffstat.files} file(s), +${generated.diffstat.added}/-${generated.diffstat.removed}; ` +
            `patch ready for driver review + git apply`,
          patch_path: relative(repoRoot, published.patchPath),
          report_path: relative(repoRoot, published.reportPath),
          patch_sha256: published.patchSha,
          files_changed: generated.filesChanged,
          diffstat: generated.diffstat,
          self_report: selfReport,
          ...(rawExcerpt !== undefined ? { self_report_raw_excerpt: rawExcerpt } : {}),
          violations: [],
          ...(proposalValidation
            ? {
                applicability: proposalValidation.applicability,
                apply_policy: proposalValidation.apply_policy,
              }
            : {}),
          warnings: [
            ...(turn.warnings ?? []),
            ...(proposalValidation?.reasons ?? []),
            ...(proposalValidation?.baseline_only
              ? [
                  "validation is baseline-only for additive tests; full driver self-test is mandatory after apply",
                ]
              : []),
          ],
          ...(proposalValidation
            ? { validation: proposalValidation }
            : {}),
          round,
          lifecycle: "completed",
          session: sessionFacts(),
        };
        record.lifecycle = "completed";
        record.result = result;
        record.patch_sha = published.patchSha;
        record.patch_size = published.patchSize;
        record.report_sha = published.reportSha;
        record.report_size = published.reportSize;
        store.write(state);
        return result;
      } catch (err) {
        // Terminalizing catch: NO post-reserve exception may strand a live nonterminal record.
        if (input.signal?.aborted) {
          return finishFailed(cancelledResult(`(${(err as Error).message})`));
        }
        return finishFailed({
          ok: false,
          error: `dispatch phase failed: ${(err as Error).message}`,
        });
      }
    } finally {
      // Derived working residue is discarded unconditionally (published artifacts persist).
      try {
        discardDispatchResources(repoRoot, record.artifact_id);
      } catch {
        /* residue GC will reap it on the next call */
      }
    }
  } finally {
    designLock.release();
  }
}

function verifyArtifacts(
  repoRoot: string,
  record: DispatchRecord,
): { ok: true } | { ok: false; error: string } {
  try {
    const result = record.result as ImplementFlowResult;
    for (const [rel, sha, size] of [
      [result.patch_path, record.patch_sha, record.patch_size],
      [result.report_path, record.report_sha, record.report_size],
    ] as const) {
      if (!rel || !sha) return { ok: false, error: "completed record missing artifact facts" };
      const bytes = readFileSync(`${repoRoot}/${rel}`);
      if (bytes.length !== size || sha256(bytes) !== sha) {
        return { ok: false, error: `artifact ${rel} does not match recorded hash/size` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
