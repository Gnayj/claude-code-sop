import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_SKILL_LIFECYCLE_FIXTURE_BINDINGS as outcome,
  classifyCodexSkillHostVersion,
} from "../src/control-surface-contract.js";
import { makeTempDir, rmDir } from "./test-helpers.js";

const templateRoot = resolve(
  import.meta.dirname,
  "../../../templates/codex-scaffold/skills",
);
const zhTemplateRoot = resolve(
  import.meta.dirname,
  "../../../templates/i18n/zh-CN/codex-scaffold/skills",
);
const deTemplateRoot = resolve(
  import.meta.dirname,
  "../../../templates/i18n/de-DE/codex-scaffold/skills",
);
const roots: string[] = [];
const legacyRel = ".codex/skills/project-sop/SKILL.md";
const canonicalRel = ".agents/skills/project-sop/SKILL.md";
const pointerLegacy = ".codex/skills/project-sop/SKILL.md";
const pointerCanonical = ".agents/skills/project-sop/SKILL.md";

interface ManifestEntry {
  path: string;
  owner: "seed" | "ccsop" | "overlay";
  rendered_sha: string;
  migrated_from?: string;
  legacy_rendered_sha?: string;
  backup_path?: string;
  backup_sha?: string;
}

interface Manifest {
  files: ManifestEntry[];
}

interface LifecycleOptions {
  usesCodex: boolean;
  version?: string;
  rollback?: boolean;
  toolAvailable?: boolean;
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function path(root: string, rel: string): string {
  return join(root, rel);
}

function read(root: string, rel: string): string {
  return readFileSync(path(root, rel), "utf8");
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(path(root, rel)), { recursive: true });
  writeFileSync(path(root, rel), text, "utf8");
}

function manifest(root: string): Manifest {
  return JSON.parse(read(root, ".ccsop/manifest.json")) as Manifest;
}

function writeManifest(root: string, value: Manifest): void {
  write(root, ".ccsop/manifest.json", `${JSON.stringify(value, null, 2)}\n`);
}

function treeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(root, entry.name);
      return entry.isDirectory() ? treeFiles(child) : [child];
    })
    .sort();
}

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    treeFiles(root).map((file) => [
      relative(root, file),
      readFileSync(file, "utf8"),
    ]),
  );
}

function canonicalEntries(root: string): ManifestEntry[] {
  const canonicalRoot = path(root, ".agents/skills");
  return treeFiles(canonicalRoot).map((file) => ({
    path: relative(root, file),
    owner: "seed",
    rendered_sha: sha(readFileSync(file, "utf8")),
  }));
}

function materializeCanonical(root: string): void {
  const target = path(root, ".agents/skills");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(templateRoot, target, { recursive: true });
}

function replacePointer(root: string, from: string, to: string): void {
  const before = read(root, "AGENTS.md");
  if (!before.includes(from)) throw new Error(`pointer preimage missing: ${from}`);
  write(root, "AGENTS.md", before.replace(from, to));
}

/**
 * Executable specification fixture for the model-driven /sop-update lifecycle. The command
 * remains the product entrypoint; this harness pins its filesystem postconditions in temp
 * consumer repos so destructive migration prose is not validated by string greps alone.
 */
function runLifecycle(root: string, options: LifecycleOptions): string {
  const legacyExists = existsSync(path(root, legacyRel));
  const canonicalRoot = path(root, ".agents/skills");
  const canonicalExists = treeFiles(canonicalRoot).some((file) => {
    const parts = relative(canonicalRoot, file).split(/[\\/]/);
    return parts.length === 2 && parts[1] === "SKILL.md";
  });
  if (!options.usesCodex && !legacyExists && !canonicalExists) return outcome.C1;

  const gate = classifyCodexSkillHostVersion(options.version);
  if (gate.status !== "supported") return outcome.C2;

  if (options.rollback) {
    const currentManifest = manifest(root);
    const entry = currentManifest.files.find(
      (candidate) => candidate.path === canonicalRel,
    );
    if (
      !entry?.backup_path ||
      !entry.backup_sha ||
      !entry.legacy_rendered_sha ||
      !existsSync(path(root, entry.backup_path)) ||
      sha(read(root, entry.backup_path)) !== entry.backup_sha ||
      !existsSync(path(root, canonicalRel)) ||
      sha(read(root, canonicalRel)) !== entry.rendered_sha ||
      existsSync(path(root, legacyRel))
    ) {
      throw new Error("rollback provenance check failed");
    }
    const legacyBytes = read(root, entry.backup_path);
    write(root, legacyRel, legacyBytes);
    replacePointer(root, pointerCanonical, pointerLegacy);
    rmSync(path(root, canonicalRel));
    currentManifest.files = currentManifest.files.filter(
      (candidate) => candidate.path !== canonicalRel,
    );
    currentManifest.files.push({
      path: legacyRel,
      owner: "seed",
      rendered_sha: entry.legacy_rendered_sha,
    });
    writeManifest(root, currentManifest);
    return outcome.C9;
  }

  let currentManifest: Manifest;
  try {
    currentManifest = manifest(root);
  } catch {
    return outcome.C4;
  }

  if (legacyExists) {
    const legacyBytes = read(root, legacyRel);
    const legacyEntry = currentManifest.files.find(
      (entry) => entry.path === legacyRel,
    );
    if (!legacyEntry || legacyEntry.owner !== "seed") {
      return outcome.C4;
    }
    if (legacyEntry.rendered_sha !== sha(legacyBytes)) {
      return outcome.C5;
    }
    if (existsSync(path(root, canonicalRel))) {
      const canonicalEntry = currentManifest.files.find(
        (entry) => entry.path === canonicalRel,
      );
      if (
        canonicalEntry?.owner === "seed" &&
        canonicalEntry.rendered_sha === sha(read(root, canonicalRel)) &&
        read(root, canonicalRel) !== legacyBytes
      ) {
        return outcome.C6;
      }
      return outcome.C5;
    }

    const legacySha = sha(legacyBytes);
    const backupRel = `.ccsop/backups/${legacySha}.SKILL.md`;
    write(root, backupRel, legacyBytes);
    materializeCanonical(root);
    replacePointer(root, pointerLegacy, pointerCanonical);
    rmSync(path(root, legacyRel));
    currentManifest.files = currentManifest.files.filter(
      (entry) => entry.path !== legacyRel,
    );
    const entries = canonicalEntries(root);
    const projectEntry = entries.find((entry) => entry.path === canonicalRel)!;
    Object.assign(projectEntry, {
      migrated_from: legacyRel,
      legacy_rendered_sha: legacyEntry.rendered_sha,
      backup_path: backupRel,
      backup_sha: legacySha,
    });
    currentManifest.files.push(...entries);
    writeManifest(root, currentManifest);
    if (options.toolAvailable === false) return outcome.C11;
    return outcome.C3;
  } else if (existsSync(path(root, canonicalRel))) {
    let changed = false;
    let preserved = false;
    for (const source of treeFiles(templateRoot)) {
      const rel = relative(templateRoot, source);
      const targetRel = `.agents/skills/${rel}`;
      const target = path(root, targetRel);
      const entry = currentManifest.files.find(
        (candidate) => candidate.path === targetRel,
      );
      if (
        !entry ||
        entry.owner !== "seed" ||
        !existsSync(target) ||
        entry.rendered_sha !== sha(readFileSync(target, "utf8"))
      ) {
        // A deleted canonical target is a re-materialization case governed by Step 2.C prose,
        // outside this modified-seed harness; do not misclassify it as consumer-preserved.
        if (existsSync(target)) preserved = true;
        continue;
      }
      const next = readFileSync(source, "utf8");
      if (readFileSync(target, "utf8") !== next) {
        writeFileSync(target, next, "utf8");
        entry.rendered_sha = sha(next);
        changed = true;
      }
    }
    if (changed) writeManifest(root, currentManifest);
    if (options.toolAvailable === false) return outcome.C11;
    if (changed) return outcome.C7;
    if (preserved) return outcome.C8;
  }

  // C11 deliberately represents a missing tool: there is no callable config path to execute.
  // Its behavioral binding is the C11 command-row assertion plus the exact config snapshot here.
  if (options.toolAvailable === false) return outcome.C11;
  return outcome.C10;
}

function runLanguageRematerialization(
  root: string,
  languageTemplateRoot = zhTemplateRoot,
): string[] {
  if (!existsSync(path(root, ".agents/skills"))) return [outcome.C12];
  const currentManifest = manifest(root);
  let changed = false;
  let preserved = false;
  for (const source of treeFiles(languageTemplateRoot)) {
    const rel = relative(languageTemplateRoot, source);
    const targetRel = `.agents/skills/${rel}`;
    const target = path(root, targetRel);
    const entry = currentManifest.files.find(
      (candidate) => candidate.path === targetRel,
    );
    if (
      !entry ||
      entry.owner !== "seed" ||
      !existsSync(target) ||
      entry.rendered_sha !== sha(readFileSync(target, "utf8"))
    ) {
      // Missing targets are governed by /sop-lang re-materialization prose, not this
      // pristine-vs-modified seed harness.
      if (existsSync(target)) preserved = true;
      continue;
    }
    const translated = readFileSync(source, "utf8");
    if (readFileSync(target, "utf8") === translated) continue;
    writeFileSync(target, translated, "utf8");
    entry.rendered_sha = sha(translated);
    changed = true;
  }
  if (changed) writeManifest(root, currentManifest);
  return [
    ...(changed ? [outcome.C13] : []),
    ...(preserved ? [outcome.C14] : []),
    ...(!changed && !preserved ? [outcome.C15] : []),
  ];
}

function fixture(options?: {
  legacy?: "pristine" | "modified" | "missing-entry" | "foreign-owner";
  canonical?: "pristine" | "modified";
  corruptManifest?: boolean;
}): string {
  const root = makeTempDir("ccsop-codex-lifecycle-");
  roots.push(root);
  write(root, "AGENTS.md", `before\n${pointerLegacy}\nafter\n`);
  write(root, ".codex-review/config.toml", "[meta]\ncontrol_surface_schema = 1\n");
  const files: ManifestEntry[] = [];

  if (options?.legacy) {
    const bytes =
      options.legacy === "modified" ? "consumer modified legacy\n" : "legacy pristine\n";
    write(root, legacyRel, bytes);
    if (options.legacy !== "missing-entry") {
      files.push({
        path: legacyRel,
        owner: options.legacy === "foreign-owner" ? "ccsop" : "seed",
        rendered_sha:
          options.legacy === "modified" ? sha("legacy pristine\n") : sha(bytes),
      });
    }
  }

  if (options?.canonical) {
    materializeCanonical(root);
    files.push(...canonicalEntries(root));
    replacePointer(root, pointerLegacy, pointerCanonical);
    if (options.canonical === "modified") {
      write(root, canonicalRel, `${read(root, canonicalRel)}\nconsumer edit\n`);
    }
  }

  if (options?.corruptManifest) {
    write(root, ".ccsop/manifest.json", "{not-json");
  } else {
    writeManifest(root, { files });
  }
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmDir(roots.pop()!);
});

describe("Codex scaffold lifecycle normative fixtures C1-C15", () => {
  it("C1 skips a Claude-only consumer with an absent or empty canonical root", () => {
    for (const emptyCanonicalRoot of [false, true]) {
      const root = fixture();
      if (emptyCanonicalRoot) {
        mkdirSync(path(root, ".agents/skills"), { recursive: true });
      }
      const before = snapshot(root);
      expect(runLifecycle(root, { usesCodex: false })).toBe(outcome.C1);
      expect(snapshot(root)).toEqual(before);
    }
  });

  it("C1 does not treat a nested noncanonical SKILL.md as a trigger", () => {
    const root = fixture();
    write(root, ".agents/skills/nested/deeper/SKILL.md", "not canonical\n");
    const before = snapshot(root);
    expect(runLifecycle(root, { usesCodex: false })).toBe(outcome.C1);
    expect(snapshot(root)).toEqual(before);
  });

  it("C1a maintains an existing canonical tree for Claude-only owners", () => {
    const root = fixture({ canonical: "pristine" });
    const before = snapshot(root);
    expect(
      runLifecycle(root, {
        usesCodex: false,
        version: "codex-cli 0.145.0-alpha.2",
      }),
    ).toBe(outcome.C10);
    expect(snapshot(root)).toEqual(before);
  });

  it("C1a preserves modified canonical seeds for Claude-only owners", () => {
    const root = fixture({ canonical: "modified" });
    const before = snapshot(root);
    expect(
      runLifecycle(root, {
        usesCodex: false,
        version: "codex-cli 0.145.0-alpha.2",
      }),
    ).toBe(outcome.C8);
    expect(snapshot(root)).toEqual(before);
  });

  it("C1a preserves a canonical-only tree when the host gate fails", () => {
    for (const version of [
      undefined,
      "not-a-version",
      "codex-cli 0.145.0-alpha.1",
    ]) {
      const root = fixture({ canonical: "pristine" });
      const before = snapshot(root);
      expect(runLifecycle(root, { usesCodex: false, version })).toBe(outcome.C2);
      expect(snapshot(root)).toEqual(before);
    }
  });

  it("C2 preserves the legacy pointer and bytes for every host-gate failure", () => {
    for (const version of [
      undefined,
      "not-a-version",
      "codex-cli 0.145.0-alpha.1",
    ]) {
      const root = fixture({ legacy: "pristine" });
      const before = snapshot(root);
      expect(runLifecycle(root, { usesCodex: true, version })).toBe(outcome.C2);
      expect(snapshot(root)).toEqual(before);
      expect(read(root, "AGENTS.md")).toContain(pointerLegacy);
    }
  });

  it("C3 migrates pristine legacy bytes with exact backup and canonical pointer", () => {
    const root = fixture({ legacy: "pristine" });
    const legacyBytes = read(root, legacyRel);
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0-alpha.2",
      }),
    ).toBe(outcome.C3);
    const entry = manifest(root).files.find((item) => item.path === canonicalRel)!;
    expect(read(root, entry.backup_path!)).toBe(legacyBytes);
    expect(entry.backup_sha).toBe(sha(legacyBytes));
    expect(read(root, canonicalRel)).toBe(
      readFileSync(join(templateRoot, "project-sop/SKILL.md"), "utf8"),
    );
    expect(existsSync(path(root, legacyRel))).toBe(false);
    expect(read(root, "AGENTS.md")).toContain(pointerCanonical);
  });

  it.each([
    ["missing entry", { legacy: "missing-entry" as const }],
    ["foreign owner", { legacy: "foreign-owner" as const }],
    ["corrupt manifest", { legacy: "pristine" as const, corruptManifest: true }],
  ])("C4 preserves unknown provenance: %s", (_label, setup) => {
    const root = fixture(setup);
    const before = snapshot(root);
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
      }),
    ).toBe(outcome.C4);
    expect(snapshot(root)).toEqual(before);
  });

  it("C5 preserves modified legacy content and its pointer", () => {
    const root = fixture({ legacy: "modified" });
    const before = snapshot(root);
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
      }),
    ).toBe(outcome.C5);
    expect(snapshot(root)).toEqual(before);
  });

  it("C6 preserves a pristine divergent legacy/canonical pair", () => {
    const root = fixture({ legacy: "pristine", canonical: "pristine" });
    replacePointer(root, pointerCanonical, pointerLegacy);
    const before = snapshot(root);
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
      }),
    ).toBe(outcome.C6);
    expect(snapshot(root)).toEqual(before);
  });

  it("C7 updates a pristine canonical render and C8 preserves a modified seed", () => {
    const pristine = fixture({ canonical: "pristine" });
    const handoffRel = ".agents/skills/handoff/SKILL.md";
    const current = manifest(pristine);
    const entry = current.files.find((item) => item.path === handoffRel)!;
    write(pristine, handoffRel, "old pristine render\n");
    entry.rendered_sha = sha("old pristine render\n");
    writeManifest(pristine, current);
    expect(
      runLifecycle(pristine, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
      }),
    ).toBe(outcome.C7);
    expect(read(pristine, handoffRel)).toBe(
      readFileSync(join(templateRoot, "handoff/SKILL.md"), "utf8"),
    );

    const modified = fixture({ canonical: "modified" });
    const before = snapshot(modified);
    expect(
      runLifecycle(modified, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
      }),
    ).toBe(outcome.C8);
    expect(snapshot(modified)).toEqual(before);
  });

  it("C9 rolls a verified migration back to exact legacy bytes and pointer", () => {
    const root = fixture({ legacy: "pristine" });
    runLifecycle(root, {
      usesCodex: true,
      version: "codex-cli 0.145.0",
    });
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
        rollback: true,
      }),
    ).toBe(outcome.C9);
    expect(read(root, legacyRel)).toBe("legacy pristine\n");
    expect(existsSync(path(root, canonicalRel))).toBe(false);
    expect(existsSync(path(root, ".agents/skills/handoff/SKILL.md"))).toBe(true);
    expect(read(root, "AGENTS.md")).toContain(pointerLegacy);
  });

  it("C10 is byte-idempotent and C11 scopes a missing config tool to zero config writes", () => {
    const root = fixture({ legacy: "pristine" });
    runLifecycle(root, {
      usesCodex: true,
      version: "codex-cli 0.145.0",
    });
    const afterFirst = snapshot(root);
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
      }),
    ).toBe(outcome.C10);
    expect(snapshot(root)).toEqual(afterFirst);

    const configBefore = read(root, ".codex-review/config.toml");
    expect(
      runLifecycle(root, {
        usesCodex: true,
        version: "codex-cli 0.145.0",
        toolAvailable: false,
      }),
    ).toBe(outcome.C11);
    expect(read(root, ".codex-review/config.toml")).toBe(configBefore);
  });

  it("C12 language rematerialization ignores unresolved legacy-only state", () => {
    const root = fixture({ legacy: "modified" });
    const before = snapshot(root);
    expect(runLanguageRematerialization(root)).toEqual([outcome.C12]);
    expect(snapshot(root)).toEqual(before);
  });

  it("C13 updates, C14 preserves, and C15 pins the language no-op", () => {
    const pristine = fixture({ canonical: "pristine" });
    expect(runLanguageRematerialization(pristine)).toEqual([outcome.C13]);
    expect(read(pristine, canonicalRel)).toBe(
      readFileSync(join(zhTemplateRoot, "project-sop/SKILL.md"), "utf8"),
    );
    expect(runLanguageRematerialization(pristine)).toEqual([outcome.C15]);

    const modified = fixture({ canonical: "modified" });
    const before = read(modified, canonicalRel);
    expect(runLanguageRematerialization(modified)).toEqual([
      outcome.C13,
      outcome.C14,
    ]);
    expect(read(modified, canonicalRel)).toBe(before);
  });

  it("L-DE3 updates, preserves, and stays idempotent with the maintained German skill tree", () => {
    const pristine = fixture({ canonical: "pristine" });
    expect(runLanguageRematerialization(pristine, deTemplateRoot)).toEqual([
      outcome.C13,
    ]);
    expect(read(pristine, canonicalRel)).toBe(
      readFileSync(join(deTemplateRoot, "project-sop/SKILL.md"), "utf8"),
    );
    const postimage = snapshot(pristine);
    expect(runLanguageRematerialization(pristine, deTemplateRoot)).toEqual([
      outcome.C15,
    ]);
    expect(snapshot(pristine)).toEqual(postimage);

    const modified = fixture({ canonical: "modified" });
    const before = read(modified, canonicalRel);
    expect(runLanguageRematerialization(modified, deTemplateRoot)).toEqual([
      outcome.C13,
      outcome.C14,
    ]);
    expect(read(modified, canonicalRel)).toBe(before);
  });
});
