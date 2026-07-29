// Fail-closed diff provisioning for reviewers that cannot inspect the repository.

import { execFileSync } from "node:child_process";

export const DIFF_SPEC_PATTERN =
  /^[A-Za-z0-9_][A-Za-z0-9_.\/~^@{}-]*(\.\.\.?[A-Za-z0-9_.\/~^@{}-]+)?$/;

/** Single source for the spec grammar prose (tool schemas + specError reuse it). */
export const DIFF_SPEC_DESCRIPTION =
  "Committed Git revision range as one token matching " +
  `${DIFF_SPEC_PATTERN.source}; examples: main...HEAD, abc123..def456, HEAD~3.`;

export interface ProvidedDiff {
  block: string;
  warnings: string[];
}

function specError(spec: string): Error {
  return new Error(
    `Invalid diff spec ${JSON.stringify(spec)}. Expected: ${DIFF_SPEC_DESCRIPTION} ` +
      "No whitespace, no leading '-'; the range must describe committed changes.",
  );
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function oversizeError(spec: string, maxBytes: number, bytes?: number): Error {
  const middle = bytes === undefined ? "exceeds" : `is ${bytes} bytes, exceeding`;
  return new Error(
    `Diff for ${spec} ${middle} max_injected_diff_bytes=${maxBytes}. ` +
      "Narrow the diff spec or review the changes in batches; the bridge will not truncate it.",
  );
}

function exceededBuffer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    code === "ENOBUFS" ||
    /maxBuffer/i.test(error.message)
  );
}

/** One git invocation policy for this module: no shell, readable failure, optional
 * oversize classification (only the full-patch call passes `oversize`). */
function runGit(
  args: string[],
  cwd: string,
  operation: string,
  oversize?: { spec: string; maxBytes: number },
): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      // Headroom over maxBytes so modest overruns can be measured precisely; anything
      // larger fails at the buffer and is reported as oversize, never truncated.
      ...(oversize ? { maxBuffer: oversize.maxBytes + 64 * 1024 } : {}),
    });
  } catch (error) {
    if (oversize && exceededBuffer(error)) {
      throw oversizeError(oversize.spec, oversize.maxBytes);
    }
    throw new Error(
      `Unable to ${operation}: Git failed in ${cwd}. Confirm this is a Git repository, ` +
        `Git is installed, and the diff spec names valid committed revisions. ${errorDetail(error)}`,
    );
  }
}

function diffFence(diff: string): string {
  let longest = 0;
  for (const match of diff.matchAll(/`+/g)) {
    if (match[0].length > longest) longest = match[0].length;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

export function provideDiff(
  spec: string,
  changedFiles: string[],
  cwd: string,
  maxBytes: number,
): ProvidedDiff {
  if (!DIFF_SPEC_PATTERN.test(spec)) throw specError(spec);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`maxBytes must be a positive integer; received ${maxBytes}.`);
  }

  // Cheap authoritative name list FIRST: it gates the expensive full-patch generation,
  // so validation failures (untracked files, stale changed_files) never pay for a patch.
  const names = runGit(
    ["diff", "--name-only", "--no-ext-diff", spec],
    cwd,
    `collect diff for ${spec}`,
  )
    .split(/\r?\n/)
    .filter((name) => name.length > 0);
  const authoritativeNames = new Set(names);
  const missing = changedFiles.filter((name) => !authoritativeNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `changed_files not present in committed diff range ${spec}: ${missing.join(", ")}. ` +
        "These files may be untracked or outside the range; commit them first or correct diff_spec.",
    );
  }
  const declaredNames = new Set(changedFiles);
  const warnings = names
    .filter((name) => !declaredNames.has(name))
    .map(
      (name) =>
        `warning: committed diff range ${spec} includes ${name}, but changed_files does not list it.`,
    );

  const diff = runGit(
    ["diff", "--no-ext-diff", "--no-textconv", "--no-color", spec],
    cwd,
    `collect diff for ${spec}`,
    { spec, maxBytes },
  );
  const diffBytes = Buffer.byteLength(diff, "utf8");
  if (diffBytes > maxBytes) throw oversizeError(spec, maxBytes, diffBytes);

  const fence = diffFence(diff);
  const body = diff.endsWith("\n") || diff.length === 0 ? diff : `${diff}\n`;

  return {
    block:
      `## [bridge-provided] Git diff\n\nSource spec: \`${spec}\`\n` +
      `Bytes: ${diffBytes}\n\n${fence}diff\n${body}${fence}`,
    warnings,
  };
}
