import { describe, expect, it } from "vitest";
import {
  resolveCodexBinary,
  formatProvenance,
  NoCodexBinaryError,
  type ResolveDeps,
} from "../src/codex-resolve.js";

// Fully-injected deps so the chain is exercised without a real filesystem / process.
function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    isPackageResolvable: () => false,
    findOnPath: () => undefined,
    smokeProbe: () => ({ ok: true, version: "0.145.0" }),
    ...over,
  };
}

describe("codex binary resolution chain (design §4.1 Part 2)", () => {
  it("link 1: explicit config path wins, highest precedence", () => {
    // Config set AND package resolvable AND a PATH binary present — config must still win.
    const r = resolveCodexBinary(
      { configPath: "/opt/codex" },
      deps({ isPackageResolvable: () => true, findOnPath: () => "/usr/bin/codex" }),
    );
    expect(r.source).toBe("config");
    expect(r.codexPathOverride).toBe("/opt/codex");
  });

  it("link 1: warn-and-proceed on smoke failure (operator chose it explicitly)", () => {
    const r = resolveCodexBinary(
      { configPath: "/opt/codex" },
      deps({ smokeProbe: () => ({ ok: false }) }),
    );
    expect(r.source).toBe("config");
    expect(r.codexPathOverride).toBe("/opt/codex"); // proceeds anyway
    expect(r.smokeFailed).toBe(true);
    expect(formatProvenance(r)).toContain("WARN");
  });

  it("link 2: package used when no config; NO override so the SDK resolves it", () => {
    const r = resolveCodexBinary({}, deps({ isPackageResolvable: () => true }));
    expect(r.source).toBe("package");
    expect(r.codexPathOverride).toBeUndefined();
  });

  it("link 2 beats link 3: package wins over a PATH binary (r3 precedence reversal)", () => {
    // This is the regression guard for the reversed order — a version-pinned package is
    // preferred over whatever happens to be on PATH.
    const r = resolveCodexBinary(
      {},
      deps({ isPackageResolvable: () => true, findOnPath: () => "/usr/bin/codex" }),
    );
    expect(r.source).toBe("package");
    expect(r.codexPathOverride).toBeUndefined();
  });

  it("link 3: PATH binary used when no config and no package, smoke ok", () => {
    const r = resolveCodexBinary(
      {},
      deps({ isPackageResolvable: () => false, findOnPath: () => "/usr/bin/codex" }),
    );
    expect(r.source).toBe("path");
    expect(r.codexPathOverride).toBe("/usr/bin/codex");
    expect(r.smokeFailed).toBeUndefined(); // path link only returns on a passing probe
    expect(r.version).toBe("0.145.0");
  });

  it("link 3 smoke failure does NOT fall back to an already-missed package — it errors (r3)", () => {
    // Reaching link 3 means link 2 already missed; a failed probe therefore cannot use the
    // package, so it must return the legible link-4 error rather than silently using a dead binary.
    expect(() =>
      resolveCodexBinary(
        {},
        deps({
          isPackageResolvable: () => false,
          findOnPath: () => "/usr/bin/codex",
          smokeProbe: () => ({ ok: false }),
        }),
      ),
    ).toThrow(NoCodexBinaryError);
  });

  it("link 4: nothing resolves → NoCodexBinaryError naming all three remedies", () => {
    let err: unknown;
    try {
      resolveCodexBinary({}, deps());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NoCodexBinaryError);
    const msg = (err as Error).message;
    expect(msg).toContain("[codex] path");
    expect(msg).toContain("@openai/codex");
    expect(msg).toContain("PATH");
  });

  it("empty/whitespace config path is treated as unset (falls through)", () => {
    const r = resolveCodexBinary({ configPath: "   " }, deps({ isPackageResolvable: () => true }));
    expect(r.source).toBe("package");
  });

  it("formatProvenance renders source, path, and version", () => {
    const r = resolveCodexBinary(
      {},
      deps({ isPackageResolvable: () => false, findOnPath: () => "/usr/bin/codex" }),
    );
    const s = formatProvenance(r);
    expect(s).toContain("source=path");
    expect(s).toContain("/usr/bin/codex");
    expect(s).toContain("0.145.0");
  });
});
