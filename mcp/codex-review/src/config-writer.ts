import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as TOML from "@iarna/toml";

import { sha256Text } from "./runtime-config-store.js";

export interface TomlUpdate {
  section: string;
  key: string;
  value: string | boolean | number;
}

export interface AtomicConfigWriteResult {
  beforeSha256: string;
  afterSha256: string;
  backupPath: string;
}

export type ConfigWriteFaultPoint =
  | "after-backup"
  | "after-temp-fsync"
  | "after-rename"
  | "after-verify";

export interface ConfigWriteOptions {
  /** Deterministic test-only crash point; production callers omit this. */
  faultAt?: ConfigWriteFaultPoint;
  /** Repository root that owns .ccsop/backups; defaults to configDir/.. for compatibility. */
  repoRoot?: string;
}

function injectFault(
  options: ConfigWriteOptions | undefined,
  point: ConfigWriteFaultPoint,
): void {
  if (options?.faultAt === point) {
    throw new Error(`injected config writer fault: ${point}`);
  }
}

function scalar(value: TomlUpdate["value"]): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function inlineCommentStart(line: string): number {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return i;
    }
  }
  return -1;
}

function sectionName(line: string): string | null {
  const match = line.match(/^\s*\[([A-Za-z0-9_.-]+)]\s*(?:#.*)?$/);
  return match?.[1] ?? null;
}

function keyName(line: string): string | null {
  if (/^\s*#/.test(line)) return null;
  const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
  return match?.[1] ?? null;
}

function upsertOne(text: string, update: TomlUpdate): string {
  const hadTerminalNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (hadTerminalNewline) lines.pop();

  const sectionStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (sectionName(lines[i]!) === update.section) sectionStarts.push(i);
  }
  if (sectionStarts.length > 1) {
    throw new Error(`duplicate TOML section [${update.section}]`);
  }

  if (sectionStarts.length === 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`[${update.section}]`, `${update.key} = ${scalar(update.value)}`);
    return `${lines.join("\n")}\n`;
  }

  const start = sectionStarts[0]!;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (sectionName(lines[i]!) !== null) {
      end = i;
      break;
    }
  }

  const matches: number[] = [];
  for (let i = start + 1; i < end; i++) {
    if (keyName(lines[i]!) === update.key) matches.push(i);
  }
  if (matches.length > 1) {
    throw new Error(`duplicate TOML key ${update.section}.${update.key}`);
  }
  if (matches.length === 1) {
    const index = matches[0]!;
    const line = lines[index]!;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 0) {
      throw new Error(`unable to locate TOML value for ${update.section}.${update.key}`);
    }
    let valueStart = equalsAt + 1;
    while (valueStart < line.length && /[ \t]/.test(line[valueStart]!)) {
      valueStart++;
    }
    const commentAt = inlineCommentStart(line);
    let valueEnd = commentAt >= 0 ? commentAt : line.length;
    while (valueEnd > valueStart && /[ \t]/.test(line[valueEnd - 1]!)) {
      valueEnd--;
    }
    lines[index] =
      `${line.slice(0, valueStart)}${scalar(update.value)}${line.slice(valueEnd)}`;
  } else {
    let insertion = end;
    while (insertion > start + 1 && lines[insertion - 1] === "") insertion--;
    lines.splice(insertion, 0, `${update.key} = ${scalar(update.value)}`);
  }

  return `${lines.join("\n")}${hadTerminalNewline ? "\n" : ""}`;
}

function parsedRecord(text: string): Record<string, unknown> {
  const parsed = TOML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("config TOML root must be an object");
  }
  return parsed as Record<string, unknown>;
}

function deleteParsedPath(root: Record<string, unknown>, section: string, key: string): void {
  const parts = section.split(".");
  let cursor: Record<string, unknown> | undefined = root;
  for (const part of parts) {
    const next = cursor[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor = undefined;
      break;
    }
    cursor = next as Record<string, unknown>;
  }
  if (cursor) delete cursor[key];
}

export function applyTomlUpdates(text: string, updates: readonly TomlUpdate[]): string {
  // Parse before editing so malformed/duplicate TOML is a zero-write failure.
  const before = parsedRecord(text);
  let candidate = text;
  for (const update of updates) candidate = upsertOne(candidate, update);
  const after = parsedRecord(candidate);

  const beforeNonTargets = structuredClone(before);
  const afterNonTargets = structuredClone(after);
  for (const update of updates) {
    deleteParsedPath(beforeNonTargets, update.section, update.key);
    deleteParsedPath(afterNonTargets, update.section, update.key);
  }
  if (!isDeepStrictEqual(beforeNonTargets, afterNonTargets)) {
    throw new Error("config writer changed non-target parsed values");
  }
  return candidate;
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeExclusiveOrVerify(path: string, text: string): void {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`backup path is not a regular file: ${path}`);
    }
    if (readFileSync(path, "utf8") !== text) {
      throw new Error(`backup hash collision/content mismatch: ${path}`);
    }
    return;
  }
  writeFileSync(path, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function ensureDirectory(path: string, mode: number): void {
  if (!existsSync(path)) {
    mkdirSync(path, { mode });
    return;
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`config control directory must not be a symlink: ${path}`);
  }
}

function restoreConfigAtomically(
  configPath: string,
  expectedCurrentText: string,
  restoreText: string,
  mode: number,
): void {
  const configDir = dirname(configPath);
  if (readFileSync(configPath, "utf8") !== expectedCurrentText) {
    throw new Error("rollback refused: config changed concurrently after publish");
  }
  const restorePath = join(
    configDir,
    `.config.toml.ccsop-rollback-${process.pid}-${Date.now().toString(36)}.tmp`,
  );
  let restoreExists = false;
  try {
    writeFileSync(restorePath, restoreText, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    restoreExists = true;
    const fd = openSync(restorePath, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(restorePath, configPath);
    restoreExists = false;
    fsyncDirectory(configDir);
    if (readFileSync(configPath, "utf8") !== restoreText) {
      throw new Error("rollback verification failed");
    }
  } finally {
    if (restoreExists) {
      try {
        unlinkSync(restorePath);
      } catch {
        // Preserve the original rollback error.
      }
    }
  }
}

function writeConfigUnderLock(
  configPath: string,
  beforeText: string,
  candidateText: string,
  options?: ConfigWriteOptions,
): AtomicConfigWriteResult {
  const beforeSha256 = sha256Text(beforeText);
  const afterSha256 = sha256Text(candidateText);
  const configDir = dirname(configPath);
  const configDirStat = lstatSync(configDir);
  if (!configDirStat.isDirectory() || configDirStat.isSymbolicLink()) {
    throw new Error(`config directory must be a real directory: ${configDir}`);
  }
  const initialStat = lstatSync(configPath);
  if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
    throw new Error(`config must be a regular non-symlink file: ${configPath}`);
  }
  if (readFileSync(configPath, "utf8") !== beforeText) {
    throw new Error("config changed after snapshot; refusing stale write");
  }
  const configMode = initialStat.mode & 0o777;
  const repoRoot = options?.repoRoot
    ? resolve(options.repoRoot)
    : resolve(configDir, "..");
  const controlDir = join(repoRoot, ".ccsop");
  const backupsDir = join(controlDir, "backups");
  const backupDir = join(backupsDir, "config");
  ensureDirectory(controlDir, 0o700);
  ensureDirectory(backupsDir, 0o700);
  ensureDirectory(backupDir, 0o700);
  const backupPath = join(backupDir, `${beforeSha256}.toml`);
  writeExclusiveOrVerify(backupPath, beforeText);
  fsyncDirectory(backupDir);
  injectFault(options, "after-backup");

  const tempPath = join(
    configDir,
    `.config.toml.ccsop-${process.pid}-${Date.now().toString(36)}.tmp`,
  );
  let tempExists = false;
  let published = false;
  try {
    writeFileSync(tempPath, candidateText, {
      encoding: "utf8",
      flag: "wx",
      mode: configMode,
    });
    tempExists = true;
    const fd = openSync(tempPath, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    injectFault(options, "after-temp-fsync");
    const publishStat = lstatSync(configPath);
    if (!publishStat.isFile() || publishStat.isSymbolicLink()) {
      throw new Error(`config became a non-regular file before publish: ${configPath}`);
    }
    if (readFileSync(configPath, "utf8") !== beforeText) {
      throw new Error("config changed concurrently before publish");
    }
    renameSync(tempPath, configPath);
    tempExists = false;
    published = true;
    injectFault(options, "after-rename");
    fsyncDirectory(configDir);
    const persisted = readFileSync(configPath, "utf8");
    if (persisted !== candidateText || sha256Text(persisted) !== afterSha256) {
      throw new Error("atomic config write verification failed");
    }
    parsedRecord(persisted);
    injectFault(options, "after-verify");
    return { beforeSha256, afterSha256, backupPath };
  } catch (err) {
    if (published) {
      try {
        restoreConfigAtomically(
          configPath,
          candidateText,
          beforeText,
          configMode,
        );
      } catch (rollbackErr) {
        throw new Error(
          `atomic config write failed (${(err as Error).message}); ` +
            `rollback also failed: ${(rollbackErr as Error).message}`,
        );
      }
    }
    throw err;
  } finally {
    if (tempExists) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Preserve the original error.
      }
    }
  }
}

export function writeConfigAtomically(
  configPath: string,
  beforeText: string,
  candidateText: string,
  options?: ConfigWriteOptions,
): AtomicConfigWriteResult {
  const configDir = dirname(configPath);
  const lockPath = join(configDir, ".config.toml.ccsop.lock");
  let lockFd: number;
  for (let attempt = 0; ; attempt++) {
    try {
      lockFd = openSync(lockPath, "wx", 0o600);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      let ownerPid: number | undefined;
      try {
        const lockStat = lstatSync(lockPath);
        if (lockStat.isFile() && !lockStat.isSymbolicLink()) {
          const parsed = Number(readFileSync(lockPath, "utf8").trim());
          if (Number.isSafeInteger(parsed) && parsed > 0) ownerPid = parsed;
        }
      } catch {
        // The owner may be publishing/releasing concurrently; fail closed below.
      }

      let ownerAlive = true;
      if (ownerPid !== undefined) {
        try {
          process.kill(ownerPid, 0);
        } catch (probeErr) {
          ownerAlive =
            (probeErr as NodeJS.ErrnoException).code !== "ESRCH";
        }
      }
      if (ownerPid !== undefined && !ownerAlive && attempt === 0) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // Another process may have adjudicated the stale lock first.
        }
      }
      const owner = ownerPid === undefined ? "unknown" : String(ownerPid);
      throw new Error(
        `config mutation lock is busy: ${lockPath} (owner pid=${owner}); ` +
          `if no ccsop writer is running, delete this lock file and retry`,
      );
    }
  }

  let operationError: unknown;
  try {
    writeFileSync(lockFd, `${process.pid}\n`, "utf8");
    fsyncSync(lockFd);
    return writeConfigUnderLock(
      configPath,
      beforeText,
      candidateText,
      options,
    );
  } catch (err) {
    operationError = err;
    throw err;
  } finally {
    let releaseError: unknown;
    try {
      closeSync(lockFd);
      unlinkSync(lockPath);
    } catch (err) {
      releaseError = err;
    }
    if (releaseError !== undefined && operationError === undefined) {
      throw new Error(
        `failed to release config mutation lock ${lockPath}: ${(releaseError as Error).message}`,
      );
    }
  }
}
