// Codex CLI binary resolution chain (design ccsop-bridge-deps-lifecycle §4.1 Part 2, Option 5).
//
// The bridge ships as a single self-contained bundle; the codex CLI is the one runtime input it
// still needs. Resolve it deterministically — first hit wins:
//
//   1. config `[codex] path`     — explicit operator override; highest precedence.
//   2. `@openai/codex` package    — if installed; deterministic, version-pinned. Let the SDK's own
//                                    findCodexPath resolve it (we pass NO codexPathOverride).
//   3. `codex` on PATH            — usually present (provider=codex requires a Codex login).
//   4. none of the above          — NoCodexBinaryError, naming all three remedies (never a crash).
//
// Ordering rationale (design r3): a version-pinned package is more predictable than "whatever
// binary is on PATH", and putting the package first costs nothing — under Option 5 the package is
// no longer installed by default, so link 2 is empty on a fresh install and link 3 still yields
// zero-install.
//
// Compatibility (design r2/r3): a *liveness* smoke probe, NOT a version-string comparison, decides
// whether an implicitly-discovered binary is used. `--version` output is captured for provenance /
// skew-warning ONLY, never as a hard gate. Deep protocol compatibility surfaces at the first real
// turn (the SDK raises, the bridge returns it as a legible error). See implement note in the card.

import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type CodexBinarySource = "config" | "package" | "path";

export interface CodexResolution {
  /** Pass to `new Codex({ codexPathOverride })`. Undefined = let the SDK resolve the package (link 2).
   * Also the resolved binary path for provenance (config / path links; undefined = package link). */
  codexPathOverride?: string;
  source: CodexBinarySource;
  /** `--version` output when a probe ran; provenance / skew-warning only, never a gate. */
  version?: string;
  /** Set (true) ONLY on the config link when an explicit-path binary fails its liveness probe —
   * the warn-and-proceed case. The PATH link never reaches here (a failed probe there throws). */
  smokeFailed?: boolean;
}

export class NoCodexBinaryError extends Error {
  constructor() {
    super(
      "ccsop review bridge: no codex CLI binary found. Resolution order (first hit wins):\n" +
        "  1. Set `[codex] path` in .codex-review/config.toml to your codex binary, or\n" +
        "  2. install the @openai/codex package (`npm install` in the bridge dir), or\n" +
        "  3. put a `codex` executable on PATH (install the Codex CLI / log in via /sop-init).\n" +
        "None resolved.",
    );
    this.name = "NoCodexBinaryError";
  }
}

/** Injectable seams so the chain is unit-testable without a real filesystem / process. */
export interface ResolveDeps {
  isPackageResolvable(): boolean;
  findOnPath(binaryName: string): string | undefined;
  /** Liveness probe: does the binary launch and exit cleanly? Captures version for provenance. */
  smokeProbe(binaryPath: string): { ok: boolean; version?: string };
}

function defaultIsPackageResolvable(): boolean {
  try {
    // Mirror the SDK's own resolution base (createRequire(import.meta.url)); in the bundle this
    // resolves relative to dist/server.js, which is exactly where link 2 must find the package.
    createRequire(import.meta.url).resolve("@openai/codex/package.json");
    return true;
  } catch {
    return false;
  }
}

function defaultFindOnPath(binaryName: string): string | undefined {
  const raw = process.env.PATH;
  if (!raw) return undefined;
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of raw.split(sep)) {
    if (!dir) continue;
    const candidate = path.join(dir, binaryName);
    try {
      // statSync throws ENOENT for a missing candidate (caught below) — no separate existsSync.
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== "win32") accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // missing / not executable / racing removal — keep scanning.
    }
  }
  return undefined;
}

function defaultSmokeProbe(binaryPath: string): { ok: boolean; version?: string } {
  try {
    const r = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return { ok: false };
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    const m = out.match(/\d+\.\d+\.\d+[^\s]*/);
    return { ok: true, ...(m ? { version: m[0] } : {}) };
  } catch {
    return { ok: false };
  }
}

const defaultDeps: ResolveDeps = {
  isPackageResolvable: defaultIsPackageResolvable,
  findOnPath: defaultFindOnPath,
  smokeProbe: defaultSmokeProbe,
};

/**
 * Resolve the codex binary per the design §4.1 chain. Throws NoCodexBinaryError only when no link
 * yields a usable binary (link 4). Never spawns for the package link (the SDK does that).
 */
export function resolveCodexBinary(
  opts: { configPath?: string },
  deps: ResolveDeps = defaultDeps,
): CodexResolution {
  const configPath = (opts.configPath ?? "").trim();

  // Link 1 — explicit config path. Highest precedence; warn-and-proceed on smoke failure (the
  // operator named this binary deliberately, so we honor it and let the caller log the skew).
  if (configPath) {
    const probe = deps.smokeProbe(configPath);
    return {
      codexPathOverride: configPath,
      source: "config",
      ...(probe.version ? { version: probe.version } : {}),
      ...(probe.ok ? {} : { smokeFailed: true }),
    };
  }

  // Link 2 — @openai/codex package if installed. Deterministic; hand off to the SDK's own resolver.
  if (deps.isPackageResolvable()) {
    return { source: "package" };
  }

  // Link 3 — codex on PATH. Implicit ⇒ must pass the liveness probe. Because link 2 has already
  // missed by construction, a failed probe cannot fall back to the package (design r3) — it returns
  // the link-4 error rather than silently using a binary that does not run.
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const onPath = deps.findOnPath(binaryName);
  if (onPath) {
    const probe = deps.smokeProbe(onPath);
    if (!probe.ok) throw new NoCodexBinaryError();
    return {
      codexPathOverride: onPath,
      source: "path",
      ...(probe.version ? { version: probe.version } : {}),
    };
  }

  // Link 4 — nothing resolved.
  throw new NoCodexBinaryError();
}

/** One-line provenance string for the startup log (design Q1.b: resolved binary must be observable). */
export function formatProvenance(r: CodexResolution): string {
  const where =
    r.source === "package"
      ? "@openai/codex package (SDK-resolved)"
      : r.codexPathOverride ?? "(unknown)";
  const ver = r.version ? ` version ${r.version}` : "";
  const warn = r.smokeFailed
    ? " [WARN: liveness probe failed — proceeding on explicit config path]"
    : "";
  return `codex binary: source=${r.source} → ${where}${ver}${warn}`;
}
