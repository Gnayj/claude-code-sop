import { describe, expect, it } from "vitest";
import {
  classifyCodexConstructionError,
  CodexCapabilityMissingError,
} from "../src/codex-client.js";
import { NoCodexBinaryError } from "../src/codex-resolve.js";

describe("classifyCodexConstructionError (design bridge-deps §4.1 Q3 — unified legibility)", () => {
  // Package link won but its native binary is missing → same user problem as link-4 exhaustion,
  // so surface the legible three-remedy NoCodexBinaryError, not the bare SDK construction text.
  it("maps a package-link 'locate Codex CLI binaries' failure to NoCodexBinaryError", () => {
    const err = classifyCodexConstructionError(
      "package",
      new Error("Unable to locate Codex CLI binaries. Ensure @openai/codex is installed with optional dependencies."),
    );
    expect(err).toBeInstanceOf(NoCodexBinaryError);
    expect(err.message).toContain("[codex] path");
    expect(err.message).toContain("@openai/codex");
    expect(err.message).toContain("PATH");
  });

  it("leaves a genuine capability failure as CodexCapabilityMissingError", () => {
    const err = classifyCodexConstructionError(
      "package",
      new Error("some unrelated SDK capability error"),
    );
    expect(err).toBeInstanceOf(CodexCapabilityMissingError);
  });

  it("does not reclassify config/path-link failures (only the package link delegates to the SDK)", () => {
    // A config/path link already pinned a codexPathOverride; its construction failure is not the
    // 'package missing binary' case, so it stays a capability error.
    const err = classifyCodexConstructionError(
      "config",
      new Error("Unable to locate Codex CLI binaries"),
    );
    expect(err).toBeInstanceOf(CodexCapabilityMissingError);
  });
});
