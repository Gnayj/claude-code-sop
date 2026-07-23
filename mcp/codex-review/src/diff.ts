// Gitless bounded git-format patch construction (design ccsop-codex-implement Q18, code r3 (d)).
//
// The patch is built ENTIRELY in server code from the two sealed byte sets: no git command
// participates, so in-content `.gitattributes` / `.gitignore` are inert bytes and can never
// transform patch bytes (the v1 "patchgen repo" subsystem is deleted). Inputs are guaranteed
// finite by the Q14 text-only contract (NUL-free, ≤ max_file_bytes per side); on top of that the
// diff carries an EXPLICIT work budget (total-line cap + Myers exploration cap + periodic
// cancellation checks) and falls back DETERMINISTICALLY to a linear whole-file replacement hunk
// (all-old-removed / all-new-added — still byte-exact and git-apply-able) when the budget is
// exhausted (design r6 c_gitless_diff_has_no_resource_bound).
//
// Path emission = config-independent C-style quoting (design §4.2.D, r7
// i_git_path_quoting_contract_incomplete): bare iff every byte is printable ASCII excluding
// `"` and `\` and the path neither begins nor ends with a space; otherwise double-quoted with
// backslash escapes, C control escapes, and 3-digit octal for every other byte <0x20 or >0x7E
// (UTF-8 bytes octal-escaped). `git apply` parses this form unconditionally; core.quotePath is
// display-only and never consulted.
//
// Content is Buffers end-to-end — nothing decodes/re-encodes file bytes (CRLF, high-bit bytes,
// missing final newlines all roundtrip exactly).

import { createHash } from "node:crypto";

// ---------- budget ----------

export interface DiffBudget {
  /** Fallback when aLines + bLines exceeds this (default 100_000). */
  maxTotalLines?: number;
  /** Fallback when the Myers edit distance exploration exceeds this D (default 1_000). */
  maxD?: number;
  /** Cancellation hook — called periodically inside the search; throw to abort. */
  checkCancel?: () => void;
}

const DEFAULT_MAX_TOTAL_LINES = 100_000;
const DEFAULT_MAX_D = 1_000;

// ---------- path quoting (§4.2.D) ----------

const C_ESCAPES = new Map<number, string>([
  [0x07, "\\a"],
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0b, "\\v"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
]);

export function needsGitPathQuoting(path: string): boolean {
  if (path.startsWith(" ") || path.endsWith(" ")) return true;
  for (const byte of Buffer.from(path, "utf8")) {
    if (byte < 0x20 || byte > 0x7e || byte === 0x22 /* " */ || byte === 0x5c /* \ */) return true;
  }
  return false;
}

/** C-style quote `prefix/path` (prefix = "a" | "b"); bare when no quoting is required. */
export function quoteGitPath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`;
  if (!needsGitPathQuoting(path)) return joined;
  let out = '"';
  for (const byte of Buffer.from(joined, "utf8")) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += "\\\\";
    else if (C_ESCAPES.has(byte)) out += C_ESCAPES.get(byte)!;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out + '"';
}

// ---------- git blob identity (index line cosmetics; plain apply never verifies these) ----------

const INDEX_ABBREV = 12;

export function gitBlobSha1(bytes: Buffer): string {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

const ZERO_ID = "0".repeat(INDEX_ABBREV);

// ---------- line model ----------

interface LineSet {
  /** Line contents WITHOUT the trailing \n (a trailing \r stays inside the line — CRLF-safe). */
  lines: Buffer[];
  noFinalNewline: boolean;
}

function splitLines(bytes: Buffer): LineSet {
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      lines.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  let noFinalNewline = false;
  if (start < bytes.length) {
    lines.push(bytes.subarray(start));
    noFinalNewline = true;
  }
  return { lines, noFinalNewline };
}

/** Intern lines to integer ids for O(1) equality. The final line of a side WITHOUT a trailing
 * newline interns with a sentinel suffix, so "foo" (no NL) never equals "foo\n" — exactly git's
 * semantics (produces -/+ plus `\ No newline` markers when only the final newline differs). */
function internLines(a: LineSet, b: LineSet): { aIds: Int32Array; bIds: Int32Array } {
  const table = new Map<string, number>();
  const idOf = (line: Buffer, sentinel: boolean): number => {
    const key = (sentinel ? "1:" : "0:") + line.toString("latin1");
    let id = table.get(key);
    if (id === undefined) {
      id = table.size;
      table.set(key, id);
    }
    return id;
  };
  const ids = (s: LineSet): Int32Array => {
    const out = new Int32Array(s.lines.length);
    for (let i = 0; i < s.lines.length; i++) {
      out[i] = idOf(s.lines[i]!, s.noFinalNewline && i === s.lines.length - 1);
    }
    return out;
  };
  return { aIds: ids(a), bIds: ids(b) };
}

// ---------- bounded Myers ----------

type Op = { kind: "eq" | "del" | "ins"; aIdx: number; bIdx: number };

/** Classic Myers O(ND) with a hard D cap; returns null when the budget is exhausted. */
function myersOps(aIds: Int32Array, bIds: Int32Array, budget: Required<Pick<DiffBudget, "maxD">> & DiffBudget): Op[] | null {
  const n = aIds.length;
  const m = bIds.length;
  const maxD = Math.min(budget.maxD, n + m);
  const offset = maxD;
  let v = new Int32Array(2 * maxD + 1);
  const trace: Int32Array[] = [];
  let found = false;
  let finalD = 0;
  for (let d = 0; d <= maxD; d++) {
    if (d % 64 === 0) budget.checkCancel?.();
    const next = Int32Array.from(v);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && aIds[x] === bIds[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        finalD = d;
        break;
      }
    }
    trace.push(next);
    v = next;
    if (found) break;
  }
  if (!found) return null;
  // Backtrack.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = finalD; d > 0; d--) {
    const prev = trace[d - 1]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: "eq", aIdx: x - 1, bIdx: y - 1 });
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push({ kind: "ins", aIdx: x, bIdx: y - 1 });
      y--;
    } else {
      ops.push({ kind: "del", aIdx: x - 1, bIdx: y });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: "eq", aIdx: x - 1, bIdx: y - 1 });
    x--;
    y--;
  }
  while (x > 0) {
    ops.push({ kind: "del", aIdx: x - 1, bIdx: y });
    x--;
  }
  while (y > 0) {
    ops.push({ kind: "ins", aIdx: x, bIdx: y - 1 });
    y--;
  }
  ops.reverse();
  return ops;
}

/** Deterministic linear fallback: one whole-file replacement (design r6). */
function replacementOps(aLen: number, bLen: number): Op[] {
  const ops: Op[] = [];
  for (let i = 0; i < aLen; i++) ops.push({ kind: "del", aIdx: i, bIdx: 0 });
  for (let j = 0; j < bLen; j++) ops.push({ kind: "ins", aIdx: aLen, bIdx: j });
  return ops;
}

// ---------- hunk assembly ----------

const CONTEXT = 3;

interface Hunk {
  aStart: number; // 1-based; 0 when aCount == 0
  aCount: number;
  bStart: number;
  bCount: number;
  /** Rendered body lines (with " ", "-", "+" prefixes and `\ No newline` markers). */
  body: Buffer[];
}

function hunkHeader(h: Hunk): Buffer {
  const fmt = (start: number, count: number): string =>
    count === 1 ? `${start}` : `${start},${count}`;
  return Buffer.from(`@@ -${fmt(h.aStart, h.aCount)} +${fmt(h.bStart, h.bCount)} @@\n`, "utf8");
}

const NO_NEWLINE_MARKER = Buffer.from("\\ No newline at end of file\n", "utf8");

function renderLine(
  prefix: string,
  line: Buffer,
  isFinalOfSide: boolean,
  sideNoFinalNewline: boolean,
): Buffer[] {
  const rendered = Buffer.concat([Buffer.from(prefix, "utf8"), line, Buffer.from("\n", "utf8")]);
  if (isFinalOfSide && sideNoFinalNewline) return [rendered, NO_NEWLINE_MARKER];
  return [rendered];
}

/** Group ops into unified hunks with CONTEXT lines of context, merging adjacent hunks. */
function buildHunks(ops: Op[], a: LineSet, b: LineSet): Hunk[] {
  // Indices (into ops) of non-eq ops.
  const changeIdx: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.kind !== "eq") changeIdx.push(i);
  }
  if (changeIdx.length === 0) return [];
  // Group changes whose surrounding context regions touch (gap of eq ops ≤ 2*CONTEXT).
  const groups: Array<{ from: number; to: number }> = [];
  let from = changeIdx[0]!;
  let prev = changeIdx[0]!;
  for (let i = 1; i < changeIdx.length; i++) {
    const cur = changeIdx[i]!;
    if (cur - prev - 1 > 2 * CONTEXT) {
      groups.push({ from, to: prev });
      from = cur;
    }
    prev = cur;
  }
  groups.push({ from, to: prev });

  const hunks: Hunk[] = [];
  for (const g of groups) {
    const start = Math.max(0, g.from - CONTEXT);
    const end = Math.min(ops.length - 1, g.to + CONTEXT);
    const body: Buffer[] = [];
    let aCount = 0;
    let bCount = 0;
    let aStartIdx: number | null = null;
    let bStartIdx: number | null = null;
    for (let i = start; i <= end; i++) {
      const op = ops[i]!;
      if (op.kind === "eq") {
        if (aStartIdx === null) aStartIdx = op.aIdx;
        if (bStartIdx === null) bStartIdx = op.bIdx;
        aCount++;
        bCount++;
        body.push(
          ...renderLine(
            " ",
            a.lines[op.aIdx]!,
            op.aIdx === a.lines.length - 1,
            a.noFinalNewline,
          ),
        );
      } else if (op.kind === "del") {
        if (aStartIdx === null) aStartIdx = op.aIdx;
        aCount++;
        body.push(
          ...renderLine("-", a.lines[op.aIdx]!, op.aIdx === a.lines.length - 1, a.noFinalNewline),
        );
      } else {
        if (bStartIdx === null) bStartIdx = op.bIdx;
        bCount++;
        body.push(
          ...renderLine("+", b.lines[op.bIdx]!, op.bIdx === b.lines.length - 1, b.noFinalNewline),
        );
      }
    }
    // 1-based starts; a zero-count side anchors at the preceding line (git convention).
    let aStart: number;
    if (aCount === 0) {
      const firstOp = ops[start]!;
      aStart = firstOp.aIdx; // number of a-lines BEFORE the insertion point
    } else {
      aStart = (aStartIdx ?? 0) + 1;
    }
    let bStart: number;
    if (bCount === 0) {
      const firstOp = ops[start]!;
      bStart = firstOp.bIdx;
    } else {
      bStart = (bStartIdx ?? 0) + 1;
    }
    hunks.push({ aStart, aCount, bStart, bCount, body });
  }
  return hunks;
}

// ---------- per-file patch ----------

export interface DiffSide {
  present: boolean;
  mode?: "100644" | "100755";
  bytes?: Buffer;
}

export interface FileDiffResult {
  text: Buffer;
  added: number;
  removed: number;
  usedFallback: boolean;
}

function countOps(ops: Op[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "ins") added++;
    else if (op.kind === "del") removed++;
  }
  return { added, removed };
}

/**
 * Build the git-format patch section for ONE path. `before`/`after` are the sealed sides
 * (absent ⇔ present:false). Content-and-mode-identical sides are the caller's bug (no delta).
 */
export function generateFilePatch(
  path: string,
  before: DiffSide,
  after: DiffSide,
  budget: DiffBudget = {},
): FileDiffResult {
  const aPath = quoteGitPath("a", path);
  const bPath = quoteGitPath("b", path);
  const header: string[] = [`diff --git ${aPath} ${bPath}`];
  const beforeBytes = before.present ? (before.bytes ?? Buffer.alloc(0)) : null;
  const afterBytes = after.present ? (after.bytes ?? Buffer.alloc(0)) : null;

  const bodyParts: Buffer[] = [];
  let added = 0;
  let removed = 0;
  let usedFallback = false;

  const diffBodies = (aBytes: Buffer, bBytes: Buffer): { hunks: Hunk[] } => {
    const a = splitLines(aBytes);
    const b = splitLines(bBytes);
    const maxTotal = budget.maxTotalLines ?? DEFAULT_MAX_TOTAL_LINES;
    const maxD = budget.maxD ?? DEFAULT_MAX_D;
    let ops: Op[] | null = null;
    if (a.lines.length + b.lines.length <= maxTotal) {
      const { aIds, bIds } = internLines(a, b);
      ops = myersOps(aIds, bIds, { maxD, checkCancel: budget.checkCancel });
    }
    if (ops === null) {
      usedFallback = true;
      ops = replacementOps(a.lines.length, b.lines.length);
    }
    const c = countOps(ops);
    added += c.added;
    removed += c.removed;
    return { hunks: buildHunks(ops, a, b) };
  };

  if (beforeBytes === null && afterBytes !== null) {
    // create
    header.push(`new file mode ${after.mode ?? "100644"}`);
    header.push(`index ${ZERO_ID}..${gitBlobSha1(afterBytes).slice(0, INDEX_ABBREV)}`);
    if (afterBytes.length > 0) {
      header.push(`--- /dev/null`, `+++ ${bPath}`);
      const { hunks } = diffBodies(Buffer.alloc(0), afterBytes);
      for (const h of hunks) bodyParts.push(hunkHeader(h), ...h.body);
    }
  } else if (beforeBytes !== null && afterBytes === null) {
    // delete
    header.push(`deleted file mode ${before.mode ?? "100644"}`);
    header.push(`index ${gitBlobSha1(beforeBytes).slice(0, INDEX_ABBREV)}..${ZERO_ID}`);
    if (beforeBytes.length > 0) {
      header.push(`--- ${aPath}`, `+++ /dev/null`);
      const { hunks } = diffBodies(beforeBytes, Buffer.alloc(0));
      for (const h of hunks) bodyParts.push(hunkHeader(h), ...h.body);
    }
  } else if (beforeBytes !== null && afterBytes !== null) {
    const modeChanged = (before.mode ?? "100644") !== (after.mode ?? "100644");
    const contentChanged = !beforeBytes.equals(afterBytes);
    if (modeChanged) {
      header.push(`old mode ${before.mode ?? "100644"}`, `new mode ${after.mode ?? "100644"}`);
    }
    if (contentChanged) {
      const oldId = gitBlobSha1(beforeBytes).slice(0, INDEX_ABBREV);
      const newId = gitBlobSha1(afterBytes).slice(0, INDEX_ABBREV);
      header.push(
        modeChanged ? `index ${oldId}..${newId}` : `index ${oldId}..${newId} ${before.mode ?? "100644"}`,
      );
      header.push(`--- ${aPath}`, `+++ ${bPath}`);
      const { hunks } = diffBodies(beforeBytes, afterBytes);
      for (const h of hunks) bodyParts.push(hunkHeader(h), ...h.body);
    }
  } else {
    throw new Error(`generateFilePatch(${path}): both sides absent (no delta)`);
  }

  const text = Buffer.concat([
    Buffer.from(header.join("\n") + "\n", "utf8"),
    ...bodyParts,
  ]);
  return { text, added, removed, usedFallback };
}

export interface PatchEntry {
  path: string;
  before: DiffSide;
  after: DiffSide;
}

export interface BuiltPatch {
  patch: Buffer;
  perFile: Map<string, { added: number; removed: number; usedFallback: boolean }>;
}

/** Concatenate per-file sections in the given (already-sorted) entry order. */
export function buildGitPatch(entries: readonly PatchEntry[], budget: DiffBudget = {}): BuiltPatch {
  const parts: Buffer[] = [];
  const perFile = new Map<string, { added: number; removed: number; usedFallback: boolean }>();
  for (const e of entries) {
    budget.checkCancel?.();
    const r = generateFilePatch(e.path, e.before, e.after, budget);
    parts.push(r.text);
    perFile.set(e.path, { added: r.added, removed: r.removed, usedFallback: r.usedFallback });
  }
  return { patch: Buffer.concat(parts), perFile };
}
