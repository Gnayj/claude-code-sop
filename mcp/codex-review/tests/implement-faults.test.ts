import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runBoundedProcess } from "../src/implement-sandbox.js";
import { makeTempDir, rmDir } from "./test-helpers.js";

const dirs: string[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  while (dirs.length > 0) rmDir(dirs.pop()!);
});

describe("Claude implement process fault handling", () => {
  it("returns a spawn error without an unhandled stdin stream error", async () => {
    const root = makeTempDir("ccsop-process-spawn-");
    dirs.push(root);
    await expect(
      runBoundedProcess(
        join(root, "missing-executable"),
        [],
        {
          cwd: root,
          env: { PATH: "/nonexistent" },
          stdin: "input that must not hit a destroyed stream",
          timeoutMs: 1000,
          maxOutputBytes: 1024,
        },
      ),
    ).rejects.toThrow(/ENOENT|stdin failed/);
  });

  it("kills and awaits the whole detached process group on timeout", async () => {
    const root = makeTempDir("ccsop-process-timeout-");
    dirs.push(root);
    const pidPath = join(root, "child.pid");
    const script = [
      "const {spawn}=require('node:child_process');",
      "const fs=require('node:fs');",
      "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
      `fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid));`,
      "setInterval(()=>{},1000);",
    ].join("");
    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", script],
        {
          cwd: root,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          stdin: "",
          timeoutMs: 150,
          maxOutputBytes: 4096,
        },
      ),
    ).rejects.toThrow(/timed out/);
    expect(existsSync(pidPath)).toBe(true);
    const pid = Number(readFileSync(pidPath, "utf8"));
    expect(alive(pid)).toBe(false);
  });

  it("kills on bounded-output overflow", async () => {
    const root = makeTempDir("ccsop-process-output-");
    dirs.push(root);
    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"],
        {
          cwd: root,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          stdin: "",
          timeoutMs: 5000,
          maxOutputBytes: 1024,
        },
      ),
    ).rejects.toThrow(/max_output_bytes=1024/);
  });

  it("kills and terminally returns cancellation", async () => {
    const root = makeTempDir("ccsop-process-cancel-");
    dirs.push(root);
    const controller = new AbortController();
    const pending = runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      {
        cwd: root,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        stdin: "",
        timeoutMs: 5000,
        maxOutputBytes: 1024,
        signal: controller.signal,
      },
    );
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow(/cancelled/);
  });
});
