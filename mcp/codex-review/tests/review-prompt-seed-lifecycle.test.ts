import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const SOURCE_ID = "templates/review-prompts/implement.md.tpl";
const TARGET_PATH = ".codex-review/templates/implement.md.tpl";
const MANIFEST_PATH = ".ccsop/manifest.json";
const RENDER = "# maintained implement prompt\n";
const CURRENT_VERSION = "0.2.14-fixture";
const STABLE_BASENAMES = [
  "code-review.md.tpl",
  "design-review.md.tpl",
  "fix-review.md.tpl",
  "implement.md.tpl",
] as const;
const LEGACY_BASENAMES = STABLE_BASENAMES.slice(0, 3);
const UNRELATED_SOURCE_ID = "templates/docs-scaffold/unrelated.md";
const UNRELATED_PATH = "docs/unrelated.md";
const UNRELATED_CURRENT_RENDER = "# current unrelated doc\n";
const temporaryRoots: string[] = [];

type Entry = {
  template_id: string;
  version: string;
  language: string;
  source_sha: string;
  rendered_sha: string;
  path: string;
  owner: "ccsop" | "seed" | "overlay";
  translation_source?: "none(en)" | "maintained" | "on-the-fly";
  translation_source_sha?: string;
};

type Manifest = { files: Entry[] };
type Mode = "update" | "lang";

type FixtureOptions = {
  entry?: "canonical" | "noncanonical-sibling";
  target?: boolean;
  mixedLanguages?: boolean;
  languageNeutral?: boolean;
};

type LegacyFixtureOptions = {
  partial?: boolean;
  unknownSibling?: boolean;
  collision?: boolean;
  basenames?: readonly string[];
  mixedPromptLanguages?: boolean;
  modifiedBasename?: string;
  deletedBasename?: string;
  unrelated?: boolean;
};

type ReconcileOptions = {
  mode: Mode;
  configLanguage?: string;
  requestedLanguage?: string;
  maintained?: boolean;
  mappingAvailable?: boolean;
  providerAvailable?: boolean;
};

function sha(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

function fixture(options: FixtureOptions = {}): string {
  const target = mkdtempSync(join(tmpdir(), "ccsop-review-prompt-seed-"));
  temporaryRoots.push(target);
  mkdirSync(resolve(target, dirname(MANIFEST_PATH)), { recursive: true });
  mkdirSync(resolve(target, dirname(TARGET_PATH)), { recursive: true });

  const files: Entry[] = [];
  if (options.entry === "canonical") {
    files.push(entryFor("zh-CN"));
  } else if (options.entry === "noncanonical-sibling") {
    files.push({
      ...entryFor("zh-CN"),
      template_id: "review-prompts/fix-review.md.tpl",
      path: ".codex-review/templates/design-review.md.tpl",
    });
  }
  if (options.mixedLanguages) {
    files.push({
      ...entryFor("en"),
      template_id: "templates/docs-scaffold/README.md",
      path: "docs/README.md",
    });
  }
  if (options.languageNeutral) {
    files.push({
      ...entryFor("en"),
      template_id: "templates/codex-scaffold/skills/simplify/references/contract.json",
      path: ".agents/skills/simplify/references/contract.json",
    });
    files.push({
      ...entryFor("en"),
      template_id: "templates/docs-scaffold/records/current.md",
      path: "docs/records/current.md",
    });
  }
  writeManifest(target, { files });
  if (options.target) writeFileSync(resolve(target, TARGET_PATH), RENDER);
  return target;
}

function entryFor(language: string): Entry {
  const maintained = language !== "en";
  const rendered = renderFor("implement.md.tpl", language);
  return {
    template_id: SOURCE_ID,
    version: CURRENT_VERSION,
    language,
    source_sha: sha("EN implement prompt\n"),
    rendered_sha: sha(rendered),
    path: TARGET_PATH,
    owner: "seed",
    translation_source: maintained ? "maintained" : "none(en)",
    ...(maintained ? { translation_source_sha: sha(rendered) } : {}),
  };
}

function stablePath(basename: string): string {
  return `.codex-review/templates/${basename}`;
}

function canonicalId(basename: string): string {
  return `templates/review-prompts/${basename}`;
}

function legacyId(basename: string): string {
  return `review-prompts/${basename}`;
}

function sourceRender(basename: string): string {
  if (basename === "implement.md.tpl") return "EN implement prompt\n";
  return `EN current ${basename}\n`;
}

function renderFor(basename: string, language: string): string {
  if (basename === "implement.md.tpl" && language === "zh-CN") return RENDER;
  return `# ${language} current ${basename}\n`;
}

function legacyFixture(options: LegacyFixtureOptions = {}): string {
  const target = mkdtempSync(join(tmpdir(), "ccsop-review-prompt-legacy-"));
  temporaryRoots.push(target);
  mkdirSync(resolve(target, dirname(MANIFEST_PATH)), { recursive: true });
  mkdirSync(resolve(target, ".codex-review/templates"), { recursive: true });

  const files: Entry[] = [];
  for (const basename of options.basenames ?? LEGACY_BASENAMES) {
    const language =
      options.mixedPromptLanguages && basename === "design-review.md.tpl"
        ? "zh-CN"
        : "en";
    const content = options.partial
      ? renderFor(basename, language)
      : `# v0.1.0 ${basename}\n`;
    files.push({
      template_id: legacyId(basename),
      version: options.partial ? CURRENT_VERSION : "0.1.0",
      language,
      source_sha: options.partial ? sha(sourceRender(basename)) : sha(content),
      rendered_sha: sha(content),
      path: stablePath(basename),
      owner: "ccsop",
    });
    if (basename !== options.deletedBasename) {
      writeFileSync(
        resolve(target, stablePath(basename)),
        basename === options.modifiedBasename ? "# consumer modified\n" : content,
      );
    }
  }

  if (options.unknownSibling) {
    const basename = "retired-review.md.tpl";
    const content = "# retired prompt\n";
    files.push({
      template_id: legacyId(basename),
      version: "0.1.0",
      language: "en",
      source_sha: sha(content),
      rendered_sha: sha(content),
      path: stablePath(basename),
      owner: "ccsop",
    });
    writeFileSync(resolve(target, stablePath(basename)), content);
  }

  if (options.collision) {
    const collisionSource = files[0];
    if (!collisionSource) {
      throw new Error("collision fixture requires at least one legacy basename");
    }
    const basename = collisionSource.path.slice(
      ".codex-review/templates/".length,
    );
    files.push({
      ...collisionSource,
      template_id: canonicalId(basename),
    });
  }

  if (options.unrelated) {
    const content = "# v0.1.0 unrelated doc\n";
    files.push({
      template_id: UNRELATED_SOURCE_ID,
      version: "0.1.0",
      language: "en",
      source_sha: sha(content),
      rendered_sha: sha(content),
      path: UNRELATED_PATH,
      owner: "ccsop",
    });
    mkdirSync(resolve(target, dirname(UNRELATED_PATH)), { recursive: true });
    writeFileSync(resolve(target, UNRELATED_PATH), content);
  }

  writeManifest(target, { files });
  return target;
}

function readManifest(target: string): Manifest {
  return JSON.parse(
    readFileSync(resolve(target, MANIFEST_PATH), "utf8"),
  ) as Manifest;
}

function writeManifest(target: string, manifest: Manifest): void {
  writeFileSync(
    resolve(target, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function appendManifestEntry(target: string, entry: Entry): void {
  const manifest = readManifest(target);
  manifest.files.push(entry);
  writeManifest(target, manifest);
}

function snapshot(target: string): { manifest: string; target: string | null } {
  return {
    manifest: readFileSync(resolve(target, MANIFEST_PATH), "utf8"),
    target: existsSync(resolve(target, TARGET_PATH))
      ? readFileSync(resolve(target, TARGET_PATH), "utf8")
      : null,
  };
}

function snapshotPaths(
  target: string,
  paths: string[],
): Record<string, string | null> {
  return Object.fromEntries(
    paths.map((path) => {
      const absolute = resolve(target, path);
      return [path, existsSync(absolute) ? readFileSync(absolute, "utf8") : null];
    }),
  );
}

type PromptClassification = {
  candidates: Entry[];
  canonical: Entry[];
  legacy: Entry[];
  invalid: Entry[];
  ambiguous: boolean;
};

function promptClassification(manifest: Manifest): PromptClassification {
  const targetPrefix = ".codex-review/templates/";
  const canonicalPrefix = "templates/review-prompts/";
  const legacyPrefix = "review-prompts/";
  const stable = new Set<string>(STABLE_BASENAMES);
  const candidates = manifest.files.filter((entry) => {
    const targetBasename = entry.path.startsWith(targetPrefix)
      ? entry.path.slice(targetPrefix.length)
      : "";
    const directTarget =
      targetBasename.endsWith(".tpl") && !targetBasename.includes("/");
    return (
      directTarget ||
      entry.template_id.startsWith(canonicalPrefix) ||
      entry.template_id.startsWith(legacyPrefix)
    );
  });

  const canonical: Entry[] = [];
  const legacy: Entry[] = [];
  const invalid: Entry[] = [];
  for (const entry of candidates) {
    const targetBasename = entry.path.startsWith(targetPrefix)
      ? entry.path.slice(targetPrefix.length)
      : "";
    const exactCanonical =
      stable.has(targetBasename) &&
      entry.path === stablePath(targetBasename) &&
      entry.template_id === canonicalId(targetBasename);
    const exactLegacy =
      stable.has(targetBasename) &&
      entry.path === stablePath(targetBasename) &&
      entry.template_id === legacyId(targetBasename);
    if (exactCanonical) canonical.push(entry);
    else if (exactLegacy) legacy.push(entry);
    else invalid.push(entry);
  }

  const pathCounts = new Map<string, number>();
  const idCounts = new Map<string, number>();
  for (const entry of candidates) {
    pathCounts.set(entry.path, (pathCounts.get(entry.path) ?? 0) + 1);
    idCounts.set(
      entry.template_id,
      (idCounts.get(entry.template_id) ?? 0) + 1,
    );
  }
  const ambiguous =
    [...pathCounts.values(), ...idCounts.values()].some((count) => count > 1);

  return { candidates, canonical, legacy, invalid, ambiguous };
}

function canonicalizeLanguage(value: string | undefined): string | null {
  const normalized = value?.trim().replaceAll("_", "-");
  if (!normalized) return null;
  if (/^zh(?:-cn|-hans)?$/i.test(normalized)) return "zh-CN";
  if (/^en$/i.test(normalized)) return "en";
  if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(normalized)) return null;
  return normalized.toLowerCase();
}

function isTranslatable(entry: Entry): boolean {
  return !new Set([
    "templates/docs-scaffold/records/current.md",
    "templates/codex-scaffold/skills/simplify/references/contract.json",
  ]).has(entry.template_id);
}

function updateExistingPrompt(
  target: string,
  entry: Entry,
  language: string,
): boolean {
  const basename = entry.path.slice(".codex-review/templates/".length);
  const targetPath = resolve(target, entry.path);
  if (!existsSync(targetPath)) return false;
  const onDisk = readFileSync(targetPath, "utf8");
  if (sha(onDisk) !== entry.rendered_sha) return false;
  const nextRender = renderFor(basename, language);
  const nextSourceSha = sha(sourceRender(basename));
  const maintained = language !== "en";
  const changed =
    onDisk !== nextRender ||
    entry.language !== language ||
    entry.source_sha !== nextSourceSha ||
    entry.rendered_sha !== sha(nextRender);
  if (!changed) return false;
  writeFileSync(targetPath, nextRender);
  entry.version = CURRENT_VERSION;
  entry.language = language;
  entry.source_sha = nextSourceSha;
  entry.rendered_sha = sha(nextRender);
  entry.translation_source = maintained ? "maintained" : "none(en)";
  if (maintained) entry.translation_source_sha = sha(nextRender);
  else delete entry.translation_source_sha;
  return true;
}

function updateUnrelated(target: string, manifest: Manifest): boolean {
  const entry = manifest.files.find(
    (candidate) => candidate.template_id === UNRELATED_SOURCE_ID,
  );
  if (!entry) return false;
  const targetPath = resolve(target, entry.path);
  if (!existsSync(targetPath)) return false;
  const onDisk = readFileSync(targetPath, "utf8");
  if (sha(onDisk) !== entry.rendered_sha) return false;
  writeFileSync(targetPath, UNRELATED_CURRENT_RENDER);
  entry.version = CURRENT_VERSION;
  entry.source_sha = sha(UNRELATED_CURRENT_RENDER);
  entry.rendered_sha = sha(UNRELATED_CURRENT_RENDER);
  return true;
}

function writeManifestIfChanged(
  target: string,
  manifest: Manifest,
  preimage: string,
): void {
  if (JSON.stringify(manifest) !== preimage) writeManifest(target, manifest);
}

function reconcile(target: string, options: ReconcileOptions): string {
  const manifest = readManifest(target);
  const manifestPreimage = JSON.stringify(manifest);
  const abortPrefix = options.mode === "lang" ? "command-abort: " : "";
  const classification = promptClassification(manifest);

  if (
    options.mode === "lang" &&
    (classification.invalid.length > 0 || classification.ambiguous)
  ) {
    return `${abortPrefix}error (noncanonical prompt template_id)`;
  }

  const language = canonicalizeLanguage(
    options.mode === "lang"
      ? (options.requestedLanguage ?? "zh-CN")
      : options.configLanguage,
  );
  const maintained = options.maintained ?? language !== "en";

  if (options.mode === "lang") {
    if (!language) return `${abortPrefix}error (unknown repository language)`;
    if (maintained && options.mappingAvailable === false) {
      return `${abortPrefix}error (unresolvable maintained mapping)`;
    }
    if (!maintained && options.providerAvailable === false) {
      return `${abortPrefix}error (no translation provider)`;
    }
  }

  if (options.mode === "update" && classification.ambiguous) {
    updateUnrelated(target, manifest);
    writeManifestIfChanged(target, manifest, manifestPreimage);
    return "error (noncanonical prompt template_id)";
  }

  if (
    options.mode === "update" &&
    classification.invalid.length > 0
  ) {
    for (const entry of [...classification.canonical, ...classification.legacy]) {
      updateExistingPrompt(
        target,
        entry,
        entry.language,
      );
    }
    updateUnrelated(target, manifest);
    writeManifestIfChanged(target, manifest, manifestPreimage);
    return "error (noncanonical prompt template_id)";
  }

  const statuses: string[] = [];
  if (classification.legacy.length > 0) {
    for (const entry of classification.legacy) {
      const basename = entry.path.slice(".codex-review/templates/".length);
      entry.template_id = canonicalId(basename);
    }
    statuses.push("legacy-template-id-migrated");
  }

  const effectiveLanguage =
    language ??
    classification.candidates.find((entry) => entry.language)?.language ??
    "en";
  let existingUpdated = false;
  for (const entry of [...classification.canonical, ...classification.legacy]) {
    existingUpdated =
      updateExistingPrompt(
        target,
        entry,
        options.mode === "lang" ? effectiveLanguage : entry.language,
      ) || existingUpdated;
  }
  if (existingUpdated) statuses.push("updated");
  if (options.mode === "update") updateUnrelated(target, manifest);

  const mixedLanguageManifest =
    options.mode === "update" &&
    language !== null &&
    manifest.files
      .filter(isTranslatable)
      .some((candidate) => candidate.language !== language);
  const summarize = (primary: string[]): string =>
    [
      ...primary,
      ...(mixedLanguageManifest ? ["mixed-language-manifest"] : []),
    ].join("; ");
  const entry = manifest.files.find((candidate) => candidate.template_id === SOURCE_ID);
  const targetExists = existsSync(resolve(target, TARGET_PATH));
  if (!targetExists && !entry) {
    if (!language) {
      writeManifestIfChanged(target, manifest, manifestPreimage);
      return summarize([
        ...statuses,
        `${abortPrefix}error (unknown repository language)`,
      ]);
    }
    if (maintained && options.mappingAvailable === false) {
      writeManifestIfChanged(target, manifest, manifestPreimage);
      return summarize([
        ...statuses,
        `${abortPrefix}error (unresolvable maintained mapping)`,
      ]);
    }
    if (!maintained && options.providerAvailable === false) {
      writeManifestIfChanged(target, manifest, manifestPreimage);
      return summarize([
        ...statuses,
        `${abortPrefix}error (no translation provider)`,
      ]);
    }
    const nextEntry: Entry = {
      ...entryFor(language),
      translation_source: maintained
        ? "maintained"
        : language === "en"
          ? "none(en)"
          : "on-the-fly",
      ...(maintained
        ? {
            translation_source_sha: sha(
              renderFor("implement.md.tpl", language),
            ),
          }
        : {}),
    };
    if (!maintained) delete nextEntry.translation_source_sha;
    writeFileSync(
      resolve(target, TARGET_PATH),
      renderFor("implement.md.tpl", language),
    );
    manifest.files.push(nextEntry);
    writeManifest(target, manifest);
    statuses.push("new-seed-added");
    return summarize(statuses);
  }
  writeManifestIfChanged(target, manifest, manifestPreimage);
  if (targetExists && !entry) {
    return summarize([
      ...statuses,
      "preserved (untracked consumer seed)",
    ]);
  }
  if (!targetExists && entry) {
    return summarize([...statuses, "preserved (consumer deletion)"]);
  }
  return summarize(statuses.length > 0 ? statuses : ["up-to-date"]);
}

function command(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function expectMatrixRow(
  spec: string,
  id: string,
  expectedTokens: string[],
): void {
  const row = spec.split("\n").find((line) => line.startsWith(`| ${id} |`));
  expect(row, `${id} row is missing`).toBeDefined();
  for (const token of expectedTokens) {
    expect(row, `${id} row must contain ${token}`).toContain(token);
  }
}

afterEach(() => {
  for (const target of temporaryRoots.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

describe("sop-init and review-prompt command contracts", () => {
  it("binds every normative fixture id to the shipped command specs", () => {
    const update = command("commands/sop-update.md");
    const lang = command("commands/sop-lang.md");
    expect(update).toContain(
      '[review].provider="codex"',
    );
    expect(update).toMatch(
      /must not be told to run\s+`\/sop-init --force`/,
    );
    const updateRows: Record<string, string[]> = {
      "U-RP1": ["atomic", "new-seed-added"],
      "U-RP2": ["unchanged", "preserved (untracked consumer seed)"],
      "U-RP3": ["unchanged", "preserved (consumer deletion)"],
      "U-RP4": ["handled once"],
      "U-RP5": ["zero-write", "error (unresolvable maintained mapping)"],
      "U-RP6": ["zero-write", "error (no translation provider)"],
      "U-RP7": ["byte-identical", "up-to-date"],
      "U-RP8": [
        "new seed zero-write",
        "recognized siblings update through U-RP4",
        "unrelated update entries continue",
        "error (noncanonical prompt template_id)",
      ],
      "U-RP9": ["zero-write", "error (unknown repository language)", "continue"],
      "U-RP10": [
        "new seed using config language",
        "existing prompt entries keep their own recorded",
        "mixed-language-manifest",
      ],
      "U-RP11": ["ID-only Transaction A", "legacy-template-id-migrated"],
      "U-RP12": ["Transaction A commits", "new seed target/entry zero-write"],
      "U-RP13": ["ID-only migration", "non-ID baseline field unchanged"],
      "U-RP14": ["whole stable-prompt reconciliation zero-write", "ambiguity"],
    };
    const langRows: Record<string, string[]> = {
      "L-RP1": ["atomic new seed", "requested language"],
      "L-RP2": ["target hash unchanged", "no entry"],
      "L-RP3": ["preserve deletion", "entry hash"],
      "L-RP4": ["existing pristine/modified seed rule"],
      "L-RP5": ["command-wide pre-write abort", "byte-identical"],
      "L-RP6": ["command-wide pre-write abort", "unchanged"],
      "L-RP7": ["byte-identical", "up-to-date"],
      "L-RP8": ["command-wide pre-write abort", "unchanged"],
      "L-RP9": ["command-wide final transaction", "legacy-template-id-migrated"],
      "L-RP10": ["command-wide pre-write abort", "all unchanged"],
      "L-RP11": ["changes only the ID", "non-ID baseline field unchanged"],
      "L-RP12": ["command-wide pre-write abort", "all bytes unchanged"],
    };
    for (const [id, tokens] of Object.entries(updateRows)) {
      expectMatrixRow(update, id, tokens);
    }
    expect(update).toMatch(
      /use the config language only for the new seed's\s+render; existing prompt entries keep their own recorded `language`/,
    );
    for (const [id, tokens] of Object.entries(langRows)) {
      expectMatrixRow(lang, id, tokens);
    }
    expect(lang).toMatch(
      /recognized-legacy `template_id`\s+normalization published with a successful command-wide transaction/,
    );

    const init = command("commands/sop-init.md");
    expect(init).toContain("one decision per tool call");
    expect(init).toMatch(/at least two mutually\s+exclusive genuine options/);
    expect(init).toContain("--project-name <name>");
    expect(init).toMatch(/invalid explicit flag aborts the whole command before any\s+target write/);
    for (const spec of [init, update, lang]) {
      expect(spec).toContain("templates/review-prompts/*.tpl");
    }
  });

  it("pins the whole-command host task/todo-tool guard in init, update, and lang", () => {
    const init = command("commands/sop-init.md");
    const update = command("commands/sop-update.md");
    const lang = command("commands/sop-lang.md");
    // Protect the category-first prohibition, open examples, no-discovery boundary, and placement.
    for (const [spec, firstStep] of [
      [init, "## Step 0"],
      [update, "## Step 0"],
      [lang, "**Step 0"],
    ]) {
      expect(spec).toMatch(/Do not\s+call any host task\/todo-tracking tool/);
      expect(spec).toContain("including but not limited to");
      for (const tool of [
        "TaskCreate",
        "TaskUpdate",
        "TaskList",
        "TaskGet",
        "TodoWrite",
      ]) {
        expect(spec).toContain(`\`${tool}\``);
      }
      expect(spec).toContain("do not discover such a tool just to mirror");
      expect(spec).toContain("may be absent from the live");
      expect(spec.indexOf("Host task-tool guard")).toBeLessThan(
        spec.indexOf(firstStep),
      );
    }
    // Keep the init guard from suppressing the legitimate Step 2 structured-question path.
    expect(init).toContain("live-schema user-question tool");
    expect(init).toContain("structured-question tool used for genuine Step 2");
    // Update may ask only at its two documented conflict decisions; lang never asks.
    expect(update).toContain("only at a step below that");
    expect(update).toContain("per-file conflict choice in Step 2");
    expect(update).toContain("C5 migration adjudication in Step 2.C");
    expect(lang).toContain("has no interactive decision point");
    expect(lang).toContain("do not call a user-question");
  });

  it("U-RP1/U-RP7 atomically add a full maintained entry and then stay idempotent", () => {
    const target = fixture();
    expect(reconcile(target, { mode: "update", configLanguage: "zh-CN" })).toBe(
      "new-seed-added",
    );
    const manifest = readManifest(target);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]).toEqual(entryFor("zh-CN"));
    expect(readFileSync(resolve(target, TARGET_PATH), "utf8")).toBe(RENDER);

    const postimage = snapshot(target);
    expect(reconcile(target, { mode: "update", configLanguage: "zh-CN" })).toBe(
      "up-to-date",
    );
    expect(snapshot(target)).toEqual(postimage);
  });

  it("U-RP2/U-RP3 preserve untracked bytes and consumer deletion", () => {
    const untracked = fixture({ target: true });
    const untrackedPreimage = snapshot(untracked);
    expect(reconcile(untracked, { mode: "update" })).toBe(
      "preserved (untracked consumer seed)",
    );
    expect(snapshot(untracked)).toEqual(untrackedPreimage);

    const deleted = fixture({ entry: "canonical" });
    const deletedPreimage = snapshot(deleted);
    expect(reconcile(deleted, { mode: "update" })).toBe(
      "preserved (consumer deletion)",
    );
    expect(snapshot(deleted)).toEqual(deletedPreimage);
  });

  it("U-RP5/U-RP6/U-RP8 fail the scoped seed with zero writes", () => {
    for (const testCase of [
      {
        root: fixture(),
        options: {
          mode: "update",
          configLanguage: "zh-CN",
          mappingAvailable: false,
        } as const,
        status: "error (unresolvable maintained mapping)",
      },
      {
        root: fixture(),
        options: {
          mode: "update",
          configLanguage: "fr",
          maintained: false,
          providerAvailable: false,
        } as const,
        status: "error (no translation provider)",
      },
      {
        root: fixture({ entry: "noncanonical-sibling" }),
        options: { mode: "update", configLanguage: "zh-CN" } as const,
        status: "error (noncanonical prompt template_id)",
      },
    ]) {
      const preimage = snapshot(testCase.root);
      expect(reconcile(testCase.root, testCase.options)).toBe(testCase.status);
      expect(snapshot(testCase.root)).toEqual(preimage);
    }
  });

  it("U-RP4 applies existing-seed rules before new-seed render prerequisites", () => {
    const target = fixture({ entry: "canonical", target: true });
    const preimage = snapshot(target);
    expect(
      reconcile(target, {
        mode: "update",
        configLanguage: "zh-CN",
        mappingAvailable: false,
      }),
    ).toBe("up-to-date");
    expect(snapshot(target)).toEqual(preimage);
  });

  it("U-RP9/U-RP10 bind unknown and mixed repository-language outcomes", () => {
    for (const configLanguage of [undefined, "not/a-language"]) {
      const target = fixture();
      const preimage = snapshot(target);
      expect(reconcile(target, { mode: "update", configLanguage })).toBe(
        "error (unknown repository language)",
      );
      expect(snapshot(target)).toEqual(preimage);
    }

    const mixed = fixture({ mixedLanguages: true });
    expect(
      reconcile(mixed, { mode: "update", configLanguage: "zh-CN" }),
    ).toBe("new-seed-added; mixed-language-manifest");
    expect(
      readManifest(mixed).files.find(
        (candidate) => candidate.template_id === SOURCE_ID,
      )?.language,
    ).toBe("zh-CN");

    const alias = fixture();
    expect(reconcile(alias, { mode: "update", configLanguage: "zh" })).toBe(
      "new-seed-added",
    );
    expect(readManifest(alias).files.at(-1)?.language).toBe("zh-CN");

    const neutral = fixture({ languageNeutral: true });
    expect(
      reconcile(neutral, { mode: "update", configLanguage: "zh-CN" }),
    ).toBe("new-seed-added");
  });

  it("U-RP11 migrates a real v0.1.0 field shape, updates pristine prompts, adds the seed, and stays idempotent", () => {
    const target = legacyFixture({ unrelated: true });
    expect(reconcile(target, { mode: "update", configLanguage: "en" })).toBe(
      "legacy-template-id-migrated; updated; new-seed-added",
    );

    const manifest = readManifest(target);
    const prompts = manifest.files.filter((entry) =>
      entry.path.startsWith(".codex-review/templates/"),
    );
    expect(prompts).toHaveLength(4);
    for (const entry of prompts) {
      const basename = entry.path.slice(".codex-review/templates/".length);
      expect(entry.template_id).toBe(canonicalId(basename));
      expect(entry.version).toBe(CURRENT_VERSION);
      expect(entry.owner).toBe(
        basename === "implement.md.tpl" ? "seed" : "ccsop",
      );
      expect(readFileSync(resolve(target, entry.path), "utf8")).toBe(
        renderFor(basename, "en"),
      );
    }
    expect(readFileSync(resolve(target, UNRELATED_PATH), "utf8")).toBe(
      UNRELATED_CURRENT_RENDER,
    );

    const paths = [
      MANIFEST_PATH,
      ...STABLE_BASENAMES.map(stablePath),
      UNRELATED_PATH,
    ];
    const postimage = snapshotPaths(target, paths);
    expect(reconcile(target, { mode: "update", configLanguage: "en" })).toBe(
      "up-to-date",
    );
    expect(snapshotPaths(target, paths)).toEqual(postimage);
  });

  it("U-RP12 commits ID migration across all new-seed prerequisite failures", () => {
    for (const testCase of [
      {
        options: {
          mode: "update",
          configLanguage: "zh-CN",
          mappingAvailable: false,
        } as const,
        error: "error (unresolvable maintained mapping)",
        mixed: true,
      },
      {
        options: {
          mode: "update",
          configLanguage: "fr",
          maintained: false,
          providerAvailable: false,
        } as const,
        error: "error (no translation provider)",
        mixed: true,
      },
      {
        options: {
          mode: "update",
          configLanguage: "not/a-language",
        } as const,
        error: "error (unknown repository language)",
        mixed: false,
      },
    ]) {
      const target = legacyFixture({ partial: true });
      const beforeEntries = readManifest(target).files;
      const stableBefore = snapshotPaths(
        target,
        LEGACY_BASENAMES.map(stablePath),
      );
      expect(reconcile(target, testCase.options)).toBe(
        [
          "legacy-template-id-migrated",
          testCase.error,
          ...(testCase.mixed ? ["mixed-language-manifest"] : []),
        ].join("; "),
      );
      const manifest = readManifest(target);
      for (const basename of LEGACY_BASENAMES) {
        const before = beforeEntries.find(
          (entry) => entry.path === stablePath(basename),
        )!;
        const after = manifest.files.find(
          (entry) => entry.path === stablePath(basename),
        )!;
        const { template_id: _beforeId, ...beforeBaselines } = before;
        const { template_id: _afterId, ...afterBaselines } = after;
        expect(after.template_id).toBe(canonicalId(basename));
        expect(afterBaselines).toEqual(beforeBaselines);
      }
      expect(snapshotPaths(target, LEGACY_BASENAMES.map(stablePath))).toEqual(
        stableBefore,
      );
      expect(existsSync(resolve(target, TARGET_PATH))).toBe(false);
      expect(
        manifest.files.some((entry) => entry.template_id === SOURCE_ID),
      ).toBe(false);
    }
  });

  it("U-RP11 recognizes a single exact legacy entry", () => {
    const target = legacyFixture({
      partial: true,
      basenames: ["code-review.md.tpl"],
    });
    expect(reconcile(target, { mode: "update", configLanguage: "en" })).toBe(
      "legacy-template-id-migrated; new-seed-added",
    );
    const manifest = readManifest(target);
    expect(
      manifest.files.find(
        (entry) => entry.path === stablePath("code-review.md.tpl"),
      )?.template_id,
    ).toBe(canonicalId("code-review.md.tpl"));
  });

  it("U-RP10 preserves each existing prompt language while seeding from config language", () => {
    const target = legacyFixture({
      partial: true,
      mixedPromptLanguages: true,
    });
    expect(reconcile(target, { mode: "update", configLanguage: "zh-CN" })).toBe(
      "legacy-template-id-migrated; new-seed-added; mixed-language-manifest",
    );
    const manifest = readManifest(target);
    for (const basename of LEGACY_BASENAMES) {
      const entry = manifest.files.find(
        (candidate) => candidate.path === stablePath(basename),
      )!;
      const expectedLanguage =
        basename === "design-review.md.tpl" ? "zh-CN" : "en";
      expect(entry.language).toBe(expectedLanguage);
      expect(readFileSync(resolve(target, entry.path), "utf8")).toBe(
        renderFor(basename, expectedLanguage),
      );
    }
    expect(
      manifest.files.find((entry) => entry.template_id === SOURCE_ID)?.language,
    ).toBe("zh-CN");
    const paths = [MANIFEST_PATH, ...STABLE_BASENAMES.map(stablePath)];
    const postimage = snapshotPaths(target, paths);
    expect(reconcile(target, { mode: "update", configLanguage: "zh-CN" })).toBe(
      "up-to-date; mixed-language-manifest",
    );
    expect(snapshotPaths(target, paths)).toEqual(postimage);
  });

  it("U-RP13 changes only IDs for modified/deleted legacy targets", () => {
    for (const protectedBasename of [
      "design-review.md.tpl",
      "fix-review.md.tpl",
    ]) {
      const target = legacyFixture({
        partial: true,
        ...(protectedBasename === "design-review.md.tpl"
          ? { modifiedBasename: protectedBasename }
          : { deletedBasename: protectedBasename }),
      });
      const before = readManifest(target).files.find(
        (entry) => entry.path === stablePath(protectedBasename),
      )!;
      const targetBefore = existsSync(resolve(target, before.path))
        ? readFileSync(resolve(target, before.path), "utf8")
        : null;
      reconcile(target, { mode: "update", configLanguage: "en" });
      const after = readManifest(target).files.find(
        (entry) => entry.path === stablePath(protectedBasename),
      )!;
      const { template_id: _beforeId, ...beforeBaselines } = before;
      const { template_id: _afterId, ...afterBaselines } = after;
      expect(after.template_id).toBe(canonicalId(protectedBasename));
      expect(afterBaselines).toEqual(beforeBaselines);
      expect(
        existsSync(resolve(target, after.path))
          ? readFileSync(resolve(target, after.path), "utf8")
          : null,
      ).toBe(targetBefore);
    }
  });

  it("U-RP8 keeps narrow failure scope for a mixed namespace", () => {
    const target = legacyFixture({
      unknownSibling: true,
      unrelated: true,
    });
    expect(reconcile(target, { mode: "update", configLanguage: "zh-CN" })).toBe(
      "error (noncanonical prompt template_id)",
    );
    const manifest = readManifest(target);
    for (const basename of LEGACY_BASENAMES) {
      const entry = manifest.files.find(
        (candidate) => candidate.path === stablePath(basename),
      )!;
      expect(entry.template_id).toBe(legacyId(basename));
      expect(entry.version).toBe(CURRENT_VERSION);
      expect(readFileSync(resolve(target, entry.path), "utf8")).toBe(
        renderFor(basename, "en"),
      );
    }
    const retired = manifest.files.find(
      (entry) => entry.path === stablePath("retired-review.md.tpl"),
    )!;
    expect(retired.template_id).toBe(legacyId("retired-review.md.tpl"));
    expect(retired.version).toBe("0.1.0");
    expect(existsSync(resolve(target, TARGET_PATH))).toBe(false);
    expect(readFileSync(resolve(target, UNRELATED_PATH), "utf8")).toBe(
      UNRELATED_CURRENT_RENDER,
    );
  });

  it("U-RP8/L-RP8 reject an out-of-directory legacy source without writes", () => {
    for (const mode of ["update", "lang"] as const) {
      const target = fixture();
      const content = "# misplaced official-looking prompt\n";
      const misplacedPath = "custom/code-review.md.tpl";
      mkdirSync(resolve(target, dirname(misplacedPath)), { recursive: true });
      writeFileSync(resolve(target, misplacedPath), content);
      appendManifestEntry(target, {
        template_id: legacyId("code-review.md.tpl"),
        version: "0.1.0",
        language: "en",
        source_sha: sha(content),
        rendered_sha: sha(content),
        path: misplacedPath,
        owner: "ccsop",
      });
      const paths = [MANIFEST_PATH, misplacedPath, TARGET_PATH];
      const preimage = snapshotPaths(target, paths);
      expect(
        reconcile(target, {
          mode,
          ...(mode === "update"
            ? { configLanguage: "en" }
            : { requestedLanguage: "zh-CN" }),
        }),
      ).toContain("error (noncanonical prompt template_id)");
      expect(snapshotPaths(target, paths)).toEqual(preimage);
    }
  });

  it("U-RP14 zero-writes the stable set on canonical/legacy collision while unrelated entries continue", () => {
    const target = legacyFixture({ collision: true, unrelated: true });
    const stablePaths = LEGACY_BASENAMES.map(stablePath);
    const stableBefore = snapshotPaths(target, stablePaths);
    const entriesBefore = readManifest(target).files.filter((entry) =>
      entry.path.startsWith(".codex-review/templates/"),
    );
    expect(reconcile(target, { mode: "update", configLanguage: "en" })).toBe(
      "error (noncanonical prompt template_id)",
    );
    expect(snapshotPaths(target, stablePaths)).toEqual(stableBefore);
    expect(
      readManifest(target).files.filter((entry) =>
        entry.path.startsWith(".codex-review/templates/"),
      ),
    ).toEqual(entriesBefore);
    expect(readFileSync(resolve(target, UNRELATED_PATH), "utf8")).toBe(
      UNRELATED_CURRENT_RENDER,
    );
  });

  it("U-RP14 treats a duplicate legacy source ID as ambiguous", () => {
    const target = legacyFixture({ unrelated: true });
    const duplicatePath = ".codex-review/templates/duplicate.md.tpl";
    const content = "# duplicate source target\n";
    writeFileSync(resolve(target, duplicatePath), content);
    appendManifestEntry(target, {
      template_id: legacyId("code-review.md.tpl"),
      version: "0.1.0",
      language: "en",
      source_sha: sha(content),
      rendered_sha: sha(content),
      path: duplicatePath,
      owner: "ccsop",
    });
    const stablePaths = [...LEGACY_BASENAMES.map(stablePath), duplicatePath];
    const stableBefore = snapshotPaths(target, stablePaths);
    const entriesBefore = readManifest(target).files.filter((entry) =>
      entry.template_id.includes("review-prompts/"),
    );
    expect(reconcile(target, { mode: "update", configLanguage: "en" })).toBe(
      "error (noncanonical prompt template_id)",
    );
    expect(snapshotPaths(target, stablePaths)).toEqual(stableBefore);
    expect(
      readManifest(target).files.filter((entry) =>
        entry.template_id.includes("review-prompts/"),
      ),
    ).toEqual(entriesBefore);
    expect(readFileSync(resolve(target, UNRELATED_PATH), "utf8")).toBe(
      UNRELATED_CURRENT_RENDER,
    );
  });

  it("L-RP1/L-RP7 use requested language rather than the old config language", () => {
    const target = fixture();
    expect(
      reconcile(target, {
        mode: "lang",
        configLanguage: "en",
        requestedLanguage: "zh-CN",
      }),
    ).toBe("new-seed-added");
    expect(readManifest(target).files[0]).toMatchObject({
      language: "zh-CN",
      translation_source: "maintained",
      translation_source_sha: sha(RENDER),
    });

    const postimage = snapshot(target);
    expect(
      reconcile(target, {
        mode: "lang",
        configLanguage: "en",
        requestedLanguage: "zh-CN",
      }),
    ).toBe("up-to-date");
    expect(snapshot(target)).toEqual(postimage);
  });

  it("L-RP2/L-RP3 preserve both consumer-owned states", () => {
    const untracked = fixture({ target: true });
    const untrackedPreimage = snapshot(untracked);
    expect(reconcile(untracked, { mode: "lang" })).toBe(
      "preserved (untracked consumer seed)",
    );
    expect(snapshot(untracked)).toEqual(untrackedPreimage);

    const deleted = fixture({ entry: "canonical" });
    const deletedPreimage = snapshot(deleted);
    expect(reconcile(deleted, { mode: "lang" })).toBe(
      "preserved (consumer deletion)",
    );
    expect(snapshot(deleted)).toEqual(deletedPreimage);
  });

  it("L-RP5/L-RP6/L-RP8 abort the command pre-write", () => {
    for (const testCase of [
      {
        root: fixture(),
        options: { mode: "lang", mappingAvailable: false } as const,
        status: "command-abort: error (unresolvable maintained mapping)",
      },
      {
        root: fixture(),
        options: {
          mode: "lang",
          maintained: false,
          providerAvailable: false,
        } as const,
        status: "command-abort: error (no translation provider)",
      },
      {
        root: fixture({ entry: "noncanonical-sibling" }),
        options: { mode: "lang" } as const,
        status: "command-abort: error (noncanonical prompt template_id)",
      },
    ]) {
      const preimage = snapshot(testCase.root);
      expect(reconcile(testCase.root, testCase.options)).toBe(testCase.status);
      expect(snapshot(testCase.root)).toEqual(preimage);
    }
  });

  it("L-RP9 stages legacy ID and pristine requested-language content together", () => {
    const target = legacyFixture();
    expect(
      reconcile(target, {
        mode: "lang",
        requestedLanguage: "zh-CN",
      }),
    ).toBe("legacy-template-id-migrated; updated; new-seed-added");
    const manifest = readManifest(target);
    for (const basename of STABLE_BASENAMES) {
      const entry = manifest.files.find(
        (candidate) => candidate.path === stablePath(basename),
      )!;
      expect(entry.template_id).toBe(canonicalId(basename));
      expect(entry.language).toBe("zh-CN");
      expect(entry.translation_source).toBe("maintained");
      expect(readFileSync(resolve(target, entry.path), "utf8")).toBe(
        renderFor(basename, "zh-CN"),
      );
    }
  });

  it("L-RP10 leaves legacy IDs, targets, and manifest unchanged on preflight failure", () => {
    const target = legacyFixture();
    const paths = [MANIFEST_PATH, ...LEGACY_BASENAMES.map(stablePath)];
    const preimage = snapshotPaths(target, paths);
    expect(
      reconcile(target, {
        mode: "lang",
        requestedLanguage: "zh-CN",
        mappingAvailable: false,
      }),
    ).toBe("command-abort: error (unresolvable maintained mapping)");
    expect(snapshotPaths(target, paths)).toEqual(preimage);
  });

  it("L-RP11 normalizes only IDs for modified/deleted legacy targets", () => {
    for (const protectedBasename of [
      "design-review.md.tpl",
      "fix-review.md.tpl",
    ]) {
      const target = legacyFixture({
        partial: true,
        ...(protectedBasename === "design-review.md.tpl"
          ? { modifiedBasename: protectedBasename }
          : { deletedBasename: protectedBasename }),
      });
      const before = readManifest(target).files.find(
        (entry) => entry.path === stablePath(protectedBasename),
      )!;
      const targetBefore = existsSync(resolve(target, before.path))
        ? readFileSync(resolve(target, before.path), "utf8")
        : null;
      reconcile(target, {
        mode: "lang",
        requestedLanguage: "zh-CN",
      });
      const after = readManifest(target).files.find(
        (entry) => entry.path === stablePath(protectedBasename),
      )!;
      const { template_id: _beforeId, ...beforeBaselines } = before;
      const { template_id: _afterId, ...afterBaselines } = after;
      expect(after.template_id).toBe(canonicalId(protectedBasename));
      expect(afterBaselines).toEqual(beforeBaselines);
      expect(
        existsSync(resolve(target, after.path))
          ? readFileSync(resolve(target, after.path), "utf8")
          : null,
      ).toBe(targetBefore);
    }
  });

  it("L-RP12 aborts the command-wide transaction on collision", () => {
    const target = legacyFixture({ collision: true, unrelated: true });
    const paths = [
      MANIFEST_PATH,
      ...LEGACY_BASENAMES.map(stablePath),
      UNRELATED_PATH,
    ];
    const preimage = snapshotPaths(target, paths);
    expect(
      reconcile(target, {
        mode: "lang",
        requestedLanguage: "zh-CN",
      }),
    ).toBe("command-abort: error (noncanonical prompt template_id)");
    expect(snapshotPaths(target, paths)).toEqual(preimage);
  });
});
