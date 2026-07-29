#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "Usage: migrate-implement-state.mjs (--to-v2|--to-v1) [--repo <root>]\n" +
      "Stop the MCP server and confirm no implement dispatch is in flight first.\n",
  );
  process.exit(2);
}

let mode = "";
let repoRoot = process.cwd();
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--to-v2" || arg === "--to-v1") mode = arg;
  else if (arg === "--repo" && process.argv[index + 1]) {
    repoRoot = resolve(process.argv[++index]);
  } else usage(`Unknown argument: ${arg}`);
}
if (!mode) usage("A migration direction is required.");

const controlRoot = join(repoRoot, ".codex-review");
const stateDir = join(controlRoot, "implement-state");
const archiveDir = join(controlRoot, "implement-state-migration-archive");
if (!existsSync(stateDir)) {
  process.stdout.write("No implement-state directory; nothing to migrate.\n");
  process.exit(0);
}
mkdirSync(archiveDir, { recursive: true, mode: 0o700 });

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function durableWrite(path, bytes) {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dirFd = openSync(dirname(path), "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

function archive(bytes, suffix) {
  const path = join(archiveDir, `${sha(bytes)}.${suffix}.json`);
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) {
      throw new Error(`archive collision at ${path}`);
    }
    return path;
  }
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return path;
}

let changed = 0;
for (const name of readdirSync(stateDir).sort()) {
  if (!name.endsWith(".implement.json")) continue;
  const path = join(stateDir, name);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`state path is not a regular file: ${path}`);
  }
  const before = readFileSync(path);
  const state = JSON.parse(before.toString("utf8"));
  if (
    !Array.isArray(state.dispatches) ||
    state.dispatches.some(
      (dispatch) =>
        dispatch.lifecycle !== "completed" && dispatch.lifecycle !== "failed",
    )
  ) {
    throw new Error(`state has an in-flight or invalid dispatch: ${path}`);
  }
  if (mode === "--to-v2") {
    if (state.schema_version === 2) continue;
    if (state.schema_version !== undefined) {
      throw new Error(`unsupported source schema in ${path}`);
    }
    archive(before, "implement-v1");
    state.schema_version = 2;
    state.writer_kind = "codex";
    state.dispatch_count_total =
      state.dispatch_count_total ?? state.dispatches.length;
    state.wall_seconds_total = state.wall_seconds_total ?? 0;
    state.budget_usd_total = state.budget_usd_total ?? 0;
    for (const dispatch of state.dispatches) {
      dispatch.writer_kind = "codex";
      dispatch.payload_schema_version = 1;
    }
  } else {
    if (state.schema_version === undefined) continue;
    if (state.schema_version !== 2 || state.writer_kind !== "codex") {
      throw new Error(
        `cannot downgrade non-Codex or future implement state: ${path}`,
      );
    }
    if (
      state.dispatches.some(
        (dispatch) =>
          dispatch.writer_kind === "claude" ||
          dispatch.payload_schema_version === 2,
      )
    ) {
      throw new Error(
        `cannot disguise v2/Claude dispatches as v1; isolate ${path} instead`,
      );
    }
    archive(before, "implement-v2");
    delete state.schema_version;
    delete state.writer_kind;
    delete state.dispatch_count_total;
    delete state.wall_seconds_total;
    delete state.budget_usd_total;
    for (const dispatch of state.dispatches) {
      delete dispatch.writer_kind;
      delete dispatch.payload_schema_version;
    }
  }
  const after = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8");
  durableWrite(path, after);
  changed++;
}

process.stdout.write(
  `${mode === "--to-v2" ? "Upgraded" : "Downgraded"} ${changed} implement-state file(s).\n`,
);
