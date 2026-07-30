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
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const checkerPath = resolve(root, "scripts/check-i18n-manifest.mjs");
const checkerAvailable = existsSync(checkerPath);
const temporaryRoots: string[] = [];
const proseExtensions = new Set([".md", ".txt", ".tpl"]);

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

function maintainedLanguages(repoRoot = root): string[] {
  return readdirSync(resolve(repoRoot, "templates/i18n"), {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        existsSync(
          resolve(
            repoRoot,
            "templates/i18n",
            entry.name,
            "i18n-manifest.json",
          ),
        ),
    )
    .map((entry) => entry.name)
    .sort();
}

function regularProseBelow(repoRoot: string, relativeRoot: string): string[] {
  const directory = resolve(repoRoot, relativeRoot);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) {
      return regularProseBelow(
        repoRoot,
        relative(repoRoot, child).split(sep).join("/"),
      );
    }
    if (
      !entry.isFile() ||
      !proseExtensions.has(extname(entry.name))
    ) {
      return [];
    }
    return [relative(repoRoot, child).split(sep).join("/")];
  });
}

function fixture(): string {
  const target = mkdtempSync(join(tmpdir(), "ccsop-i18n-manifest-"));
  temporaryRoots.push(target);
  cpSync(resolve(root, "README.md"), resolve(target, "README.md"));
  for (const language of maintainedLanguages()) {
    cpSync(
      resolve(root, `README.${language}.md`),
      resolve(target, `README.${language}.md`),
    );
  }
  cpSync(resolve(root, "templates"), resolve(target, "templates"), {
    recursive: true,
  });
  return target;
}

function manifestPath(fixtureRoot: string, language: string): string {
  return resolve(
    fixtureRoot,
    `templates/i18n/${language}/i18n-manifest.json`,
  );
}

function readManifest(fixtureRoot: string, language: string): Manifest {
  return JSON.parse(
    readFileSync(manifestPath(fixtureRoot, language), "utf8"),
  ) as Manifest;
}

function writeManifest(
  fixtureRoot: string,
  language: string,
  manifest: Manifest,
): void {
  writeFileSync(
    manifestPath(fixtureRoot, language),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
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
  return [...new Set(text.match(/\{\{[^{}\n]+\}\}/g) ?? [])].sort();
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

function jsonContracts(text: string): Array<Record<string, string>> {
  return parseJsonObjects(text)
    .map((object) =>
      Object.fromEntries(
        Object.entries(object)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, valueShape(value)]),
      ),
    )
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

function protectedTokens(text: string): string[] {
  const tokens = new Set<string>();
  const patterns = [
    /\{\{[^{}\n]+\}\}/g,
    /\$\{[^{}\n]+\}/g,
    /§\d+(?:\.[A-Za-z0-9]+)*/g,
    /\b9\.[A-E](?:\.\d+)?\b/g,
    /`\/(?:ccsop:)?[a-z][a-z0-9-]*`/g,
    /`\$[a-z][a-z0-9-]*`/g,
    /`[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+:?`/g,
    /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g,
    /\b(?:Go-after-fixes|Go|Rereview-after-fixes|No-Go|Pass-after-fixes|Pass|All-fixed|Partial|New-issues)\b/g,
  ];
  for (const pattern of patterns) {
    for (const token of text.match(pattern) ?? []) tokens.add(token);
  }
  return [...tokens].sort();
}

afterEach(() => {
  for (const target of temporaryRoots.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

describe.skipIf(!checkerAvailable)("maintained i18n manifest closure", () => {
  it("discovers the exact current consumer prose set", () => {
    const required = checker().discoverRequiredSources(root);
    const expected = [
      "README.md",
      ...regularProseBelow(root, "templates/docs-scaffold").filter(
        (source) => source !== "templates/docs-scaffold/records/current.md",
      ),
      ...regularProseBelow(root, "templates/review-prompts"),
      ...regularProseBelow(root, "templates/codex-scaffold"),
    ].sort();
    expect(required).toEqual(expected);
    expect(required).toHaveLength(25);
    expect(
      required.filter((source) => source === "README.md"),
    ).toHaveLength(1);
    expect(
      required.filter((source) =>
        source.startsWith("templates/docs-scaffold/"),
      ),
    ).toHaveLength(11);
    expect(
      required.filter((source) =>
        source.startsWith("templates/review-prompts/"),
      ),
    ).toHaveLength(4);
    expect(
      required.filter((source) =>
        source.startsWith("templates/codex-scaffold/"),
      ),
    ).toHaveLength(9);
    expect(required).toContain("templates/review-prompts/implement.md.tpl");
    expect(required).toContain(
      "templates/codex-scaffold/skills/simplify/SKILL.md",
    );
    expect(required).not.toContain(
      "templates/docs-scaffold/records/current.md",
    );
    expect(required).not.toContain(
      "templates/codex-scaffold/skills/simplify/references/contract.json",
    );
    expect(required).not.toContain(
      "templates/control-surface/codex-skill-host-contract.md",
    );
  });

  it("accepts complete mappings for every maintained language", () => {
    expect(checker().checkI18nManifests(root)).toMatchObject({
      ok: true,
      errors: [],
    });
    for (const language of maintainedLanguages()) {
      const manifest = readManifest(root, language);
      expect(manifest.files).toHaveLength(28);
      expect(
        manifest.files.filter((entry) =>
          entry.source_path.startsWith("templates/control-surface/"),
        ),
      ).toHaveLength(3);
    }
  });

  it.each(maintainedLanguages())(
    "does not require every permitted derived %s mapping",
    (language) => {
      const target = fixture();
      const manifest = readManifest(target, language);
      manifest.files = manifest.files.filter(
        (entry) =>
          entry.source_path !==
          "templates/control-surface/codex-skill-host-contract.md",
      );
      writeManifest(target, language, manifest);
      expect(checker().checkI18nManifests(target)).toMatchObject({
        ok: true,
        errors: [],
      });
    },
  );

  it.each(maintainedLanguages())(
    "rejects a missing required %s source mapping",
    (language) => {
      const target = fixture();
      const manifest = readManifest(target, language);
      manifest.files = manifest.files.filter(
        (entry) =>
          entry.source_path !==
          "templates/review-prompts/implement.md.tpl",
      );
      writeManifest(target, language, manifest);
      expect(errorsFor(target)).toContain(
        `${language}: missing required source mapping templates/review-prompts/implement.md.tpl`,
      );
    },
  );

  it.each(maintainedLanguages())(
    "rejects duplicate and unexpected %s mappings",
    (language) => {
      const target = fixture();
      const manifest = readManifest(target, language);
      manifest.files.push({ ...manifest.files[0]! });
      manifest.files.push({
        source_path: "templates/config.toml.tpl",
        source_sha: "0".repeat(64),
        target_rel: `templates/i18n/${language}/unexpected-config.toml.tpl`,
      });
      mkdirSync(dirname(resolve(target, manifest.files.at(-1)!.target_rel)), {
        recursive: true,
      });
      writeFileSync(
        resolve(target, manifest.files.at(-1)!.target_rel),
        "unexpected\n",
      );
      writeManifest(target, language, manifest);

      const errors = errorsFor(target);
      expect(errors).toContain(
        `${language}: duplicate source_path ${manifest.files[0]!.source_path}`,
      );
      expect(errors).toContain(
        `${language}: duplicate target_rel ${manifest.files[0]!.target_rel}`,
      );
      expect(errors).toContain(
        `${language}: unexpected source mapping templates/config.toml.tpl`,
      );
    },
  );

  it.each(maintainedLanguages())(
    "reports %s drift, missing target, and unexpected target together",
    (language) => {
      const target = fixture();
      const manifest = readManifest(target, language);
      const implement = manifest.files.find(
        (entry) =>
          entry.source_path ===
          "templates/review-prompts/implement.md.tpl",
      )!;
      const design = manifest.files.find(
        (entry) =>
          entry.source_path ===
          "templates/review-prompts/design-review.md.tpl",
      )!;
      implement.source_sha = "f".repeat(64);
      rmSync(resolve(target, implement.target_rel));
      design.target_rel = design.source_path;
      writeManifest(target, language, manifest);

      const errors = errorsFor(target);
      expect(errors).toContain(`${language}: DRIFTED ${implement.target_rel}`);
      expect(errors).toContain(
        `${language}: missing or non-regular translated target ${implement.target_rel}`,
      );
      expect(errors).toContain(
        `${language}: unexpected target location ${design.target_rel}`,
      );
    },
  );

  it("I-DE1 keeps checker errors distinct from consumer update errors", () => {
    const missingMapping = fixture();
    const manifest = readManifest(missingMapping, "de-DE");
    manifest.files = manifest.files.filter(
      (entry) => entry.source_path !== "README.md",
    );
    writeManifest(missingMapping, "de-DE", manifest);
    const manifestPreimage = readFileSync(
      manifestPath(missingMapping, "de-DE"),
      "utf8",
    );
    expect(errorsFor(missingMapping)).toContain(
      "de-DE: missing required source mapping README.md",
    );
    expect(
      readFileSync(manifestPath(missingMapping, "de-DE"), "utf8"),
    ).toBe(manifestPreimage);

    const missingTarget = fixture();
    rmSync(resolve(missingTarget, "README.de-DE.md"));
    expect(errorsFor(missingTarget)).toContain(
      "de-DE: missing or non-regular translated target README.de-DE.md",
    );
  });
});

describe("maintained-language machine parity", () => {
  // The three review-stage templates contain placeholders but no literal JSON
  // object; implement.md.tpl deliberately carries the sole concrete object.
  const promptObjectFloors: Record<string, Array<Record<string, string>>> = {
    "code-review.md.tpl": [],
    "design-review.md.tpl": [],
    "fix-review.md.tpl": [],
    "implement.md.tpl": [
      {
        files: "array",
        notes: "string",
        risks: "array",
        summary: "string",
        tests_run: "array",
      },
    ],
  };

  it("enumerates the exact maintained-language set", () => {
    expect(maintainedLanguages()).toEqual(["de-DE", "zh-CN"]);
  });

  it("checks every review prompt without a vacuous last-object heuristic", () => {
    const promptBasenames = readdirSync(
      resolve(root, "templates/review-prompts"),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tpl"))
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(promptObjectFloors).sort()).toEqual(promptBasenames);
    for (const basename of promptBasenames) {
      const en = readFileSync(
        resolve(root, "templates/review-prompts", basename),
        "utf8",
      );
      const enContracts = jsonContracts(en);
      expect(
        extractPlaceholders(en).length,
        `${basename} placeholder floor`,
      ).toBeGreaterThan(0);
      expect(enContracts, `${basename} EN JSON floor`).toEqual(
        promptObjectFloors[basename],
      );
      for (const language of maintainedLanguages()) {
        const translated = readFileSync(
          resolve(
            root,
            `templates/i18n/${language}/review-prompts/${basename}`,
          ),
          "utf8",
        );
        expect(
          extractPlaceholders(translated),
          `${language}/${basename} placeholders`,
        ).toEqual(extractPlaceholders(en));
        expect(
          jsonContracts(translated),
          `${language}/${basename} JSON contracts`,
        ).toEqual(enContracts);
      }
    }
  });

  it("preserves protected token spellings across every manifest mapping", () => {
    for (const language of maintainedLanguages()) {
      const manifest = readManifest(root, language);
      expect(manifest.files).toHaveLength(28);
      for (const entry of manifest.files) {
        const source = readFileSync(resolve(root, entry.source_path), "utf8");
        const translated = readFileSync(resolve(root, entry.target_rel), "utf8");
        expect(
          translated,
          `${language}: ${entry.target_rel} must differ from EN`,
        ).not.toBe(source);
        expect(
          protectedTokens(translated),
          `${language}: ${entry.target_rel}`,
        ).toEqual(protectedTokens(source));
      }
    }
  });
});
