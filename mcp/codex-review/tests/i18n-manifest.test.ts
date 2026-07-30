import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const checkerPath = resolve(root, "scripts/check-i18n-manifest.mjs");
const checkerAvailable = existsSync(checkerPath);
const temporaryRoots: string[] = [];

type CheckerModule = {
  checkI18nManifests(repoRoot: string): {
    ok: boolean;
    errors: string[];
    requiredSources: string[];
  };
  discoverRequiredSources(repoRoot: string): string[];
};

const checkerModule = checkerAvailable
  ? ((await import(pathToFileURL(checkerPath).href)) as CheckerModule)
  : null;

type ManifestEntry = {
  source_path: string;
  source_sha: string;
  target_rel: string;
};

type Manifest = {
  lang: string;
  generated: string;
  files: ManifestEntry[];
};

function fixture(): string {
  const target = mkdtempSync(join(tmpdir(), "ccsop-i18n-manifest-"));
  temporaryRoots.push(target);
  cpSync(resolve(root, "README.md"), resolve(target, "README.md"));
  cpSync(resolve(root, "README.zh-CN.md"), resolve(target, "README.zh-CN.md"));
  cpSync(resolve(root, "templates"), resolve(target, "templates"), {
    recursive: true,
  });
  return target;
}

function manifestPath(fixtureRoot: string): string {
  return resolve(fixtureRoot, "templates/i18n/zh-CN/i18n-manifest.json");
}

function readManifest(fixtureRoot: string): Manifest {
  return JSON.parse(readFileSync(manifestPath(fixtureRoot), "utf8")) as Manifest;
}

function writeManifest(fixtureRoot: string, manifest: Manifest): void {
  writeFileSync(manifestPath(fixtureRoot), `${JSON.stringify(manifest, null, 2)}\n`);
}

function checker(): CheckerModule {
  if (!checkerModule) {
    throw new Error("private i18n checker is unavailable in this stripped export");
  }
  return checkerModule;
}

function errorsFor(fixtureRoot: string): string {
  return checker().checkI18nManifests(fixtureRoot).errors.join("\n");
}

function extractPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\{\{[^{}]+\}\}/g) ?? [])].sort();
}

function parseJsonObjects(text: string): Record<string, unknown>[] {
  const parsed: Array<{ end: number; value: Record<string, unknown> }> = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char !== "}") continue;
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const value = JSON.parse(text.slice(start, cursor + 1)) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          parsed.push({
            end: cursor,
            value: value as Record<string, unknown>,
          });
        }
      } catch {
        // Template placeholders and prose braces are intentionally ignored.
      }
      break;
    }
  }
  return parsed
    .sort((left, right) => left.end - right.end)
    .map((candidate) => candidate.value);
}

function valueShape(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

afterEach(() => {
  for (const target of temporaryRoots.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

describe.skipIf(!checkerAvailable)("maintained i18n manifest closure", () => {
  it("discovers the consumer prose set without language-neutral or internal-only files", () => {
    const required = checker().discoverRequiredSources(root);
    expect(required).toContain("templates/review-prompts/implement.md.tpl");
    expect(required).toContain("templates/codex-scaffold/skills/simplify/SKILL.md");
    expect(required).not.toContain("templates/docs-scaffold/records/current.md");
    expect(required).not.toContain(
      "templates/codex-scaffold/skills/simplify/references/contract.json",
    );
    expect(required).not.toContain(
      "templates/control-surface/codex-skill-host-contract.md",
    );
    const expectedReviewPrompts = readdirSync(
      resolve(root, "templates/review-prompts"),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tpl"))
      .map((entry) => `templates/review-prompts/${entry.name}`)
      .sort();
    expect(
      required.filter((source) =>
        source.startsWith("templates/review-prompts/"),
      ),
    ).toEqual(expectedReviewPrompts);
  });

  it("accepts complete mappings and does not require every permitted derived mapping", () => {
    expect(checker().checkI18nManifests(root)).toMatchObject({
      ok: true,
      errors: [],
    });

    const target = fixture();
    const manifest = readManifest(target);
    manifest.files = manifest.files.filter(
      (entry) =>
        entry.source_path !==
        "templates/control-surface/codex-skill-host-contract.md",
    );
    writeManifest(target, manifest);
    expect(checker().checkI18nManifests(target)).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  it("rejects a missing required source mapping", () => {
    const target = fixture();
    const manifest = readManifest(target);
    manifest.files = manifest.files.filter(
      (entry) => entry.source_path !== "templates/review-prompts/implement.md.tpl",
    );
    writeManifest(target, manifest);
    expect(errorsFor(target)).toContain(
      "missing required source mapping templates/review-prompts/implement.md.tpl",
    );
  });

  it("rejects duplicate and unexpected mappings", () => {
    const target = fixture();
    const manifest = readManifest(target);
    manifest.files.push({ ...manifest.files[0]! });
    manifest.files.push({
      source_path: "templates/config.toml.tpl",
      source_sha: "0".repeat(64),
      target_rel: "templates/i18n/zh-CN/unexpected-config.toml.tpl",
    });
    mkdirSync(dirname(resolve(target, manifest.files.at(-1)!.target_rel)), {
      recursive: true,
    });
    writeFileSync(resolve(target, manifest.files.at(-1)!.target_rel), "unexpected\n");
    writeManifest(target, manifest);

    const errors = errorsFor(target);
    expect(errors).toContain(`duplicate source_path ${manifest.files[0]!.source_path}`);
    expect(errors).toContain(`duplicate target_rel ${manifest.files[0]!.target_rel}`);
    expect(errors).toContain("unexpected source mapping templates/config.toml.tpl");
  });

  it("reports source drift, missing target, and unexpected target location together", () => {
    const target = fixture();
    const manifest = readManifest(target);
    const implement = manifest.files.find(
      (entry) => entry.source_path === "templates/review-prompts/implement.md.tpl",
    )!;
    const design = manifest.files.find(
      (entry) => entry.source_path === "templates/review-prompts/design-review.md.tpl",
    )!;
    implement.source_sha = "f".repeat(64);
    rmSync(resolve(target, implement.target_rel));
    design.target_rel = design.source_path;
    writeManifest(target, manifest);

    const errors = errorsFor(target);
    expect(errors).toContain(`DRIFTED ${implement.target_rel}`);
    expect(errors).toContain(`missing or non-regular translated target ${implement.target_rel}`);
    expect(errors).toContain(`unexpected target location ${design.target_rel}`);
  });
});

describe("maintained implement prompt machine parity", () => {
  it("derives implement-prompt placeholders and final JSON shape from EN and zh", () => {
    const en = readFileSync(
      resolve(root, "templates/review-prompts/implement.md.tpl"),
      "utf8",
    );
    const zh = readFileSync(
      resolve(root, "templates/i18n/zh-CN/review-prompts/implement.md.tpl"),
      "utf8",
    );
    expect(extractPlaceholders(zh)).toEqual(extractPlaceholders(en));

    const enObjects = parseJsonObjects(en);
    const zhObjects = parseJsonObjects(zh);
    expect(enObjects.length).toBeGreaterThan(0);
    expect(zhObjects.length).toBeGreaterThan(0);
    const enSchema = enObjects.at(-1)!;
    const zhSchema = zhObjects.at(-1)!;
    expect(Object.keys(enSchema).length).toBeGreaterThan(0);
    expect(Object.keys(zhSchema).length).toBeGreaterThan(0);
    expect(Object.keys(zhSchema).sort()).toEqual(Object.keys(enSchema).sort());
    expect(
      Object.fromEntries(
        Object.entries(zhSchema).map(([key, value]) => [key, valueShape(value)]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(enSchema).map(([key, value]) => [key, valueShape(value)]),
      ),
    );
  });
});
