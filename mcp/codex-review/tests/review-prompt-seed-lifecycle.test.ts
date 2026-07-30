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
const temporaryRoots: string[] = [];

type Entry = {
  template_id: string;
  version: string;
  language: string;
  source_sha: string;
  rendered_sha: string;
  path: string;
  owner: "seed";
  translation_source: "none(en)" | "maintained" | "on-the-fly";
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
      template_id: "review-prompts/design-review.md.tpl",
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
  return {
    template_id: SOURCE_ID,
    version: "0.2.14-fixture",
    language,
    source_sha: sha("EN implement prompt\n"),
    rendered_sha: sha(RENDER),
    path: TARGET_PATH,
    owner: "seed",
    translation_source: maintained ? "maintained" : "none(en)",
    ...(maintained ? { translation_source_sha: sha(RENDER) } : {}),
  };
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

function snapshot(target: string): { manifest: string; target: string | null } {
  return {
    manifest: readFileSync(resolve(target, MANIFEST_PATH), "utf8"),
    target: existsSync(resolve(target, TARGET_PATH))
      ? readFileSync(resolve(target, TARGET_PATH), "utf8")
      : null,
  };
}

function canonicalPromptId(entry: Entry): boolean {
  const prefix = ".codex-review/templates/";
  if (!entry.path.startsWith(prefix)) return true;
  const basename = entry.path.slice(prefix.length);
  if (basename.includes("/") || !basename.endsWith(".tpl")) return true;
  return entry.template_id === `templates/review-prompts/${basename}`;
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

function reconcile(target: string, options: ReconcileOptions): string {
  const manifest = readManifest(target);
  const abortPrefix = options.mode === "lang" ? "command-abort: " : "";
  if (manifest.files.some((entry) => !canonicalPromptId(entry))) {
    return `${abortPrefix}error (noncanonical prompt template_id)`;
  }

  const maintained = options.maintained ?? true;
  const language = canonicalizeLanguage(
    options.mode === "lang"
      ? (options.requestedLanguage ?? "zh-CN")
      : options.configLanguage,
  );

  if (options.mode === "lang") {
    if (!language) return `${abortPrefix}error (unknown repository language)`;
    if (maintained && options.mappingAvailable === false) {
      return `${abortPrefix}error (unresolvable maintained mapping)`;
    }
    if (!maintained && options.providerAvailable === false) {
      return `${abortPrefix}error (no translation provider)`;
    }
  }

  const entry = manifest.files.find((candidate) => candidate.template_id === SOURCE_ID);
  const targetExists = existsSync(resolve(target, TARGET_PATH));
  if (!targetExists && !entry) {
    if (!language) return `${abortPrefix}error (unknown repository language)`;
    if (maintained && options.mappingAvailable === false) {
      return `${abortPrefix}error (unresolvable maintained mapping)`;
    }
    if (!maintained && options.providerAvailable === false) {
      return `${abortPrefix}error (no translation provider)`;
    }
    const mixedLanguageManifest =
      options.mode === "update" &&
      manifest.files
        .filter(isTranslatable)
        .some((candidate) => candidate.language !== language);
    const nextEntry: Entry = {
      ...entryFor(language),
      translation_source: maintained
        ? "maintained"
        : language === "en"
          ? "none(en)"
          : "on-the-fly",
      ...(maintained ? { translation_source_sha: sha(RENDER) } : {}),
    };
    if (!maintained) delete nextEntry.translation_source_sha;
    writeFileSync(resolve(target, TARGET_PATH), RENDER);
    manifest.files.push(nextEntry);
    writeManifest(target, manifest);
    return mixedLanguageManifest
      ? "new-seed-added; mixed-language-manifest"
      : "new-seed-added";
  }
  if (targetExists && !entry) return "preserved (untracked consumer seed)";
  if (!targetExists && entry) return "preserved (consumer deletion)";
  return "up-to-date";
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
      "U-RP8": ["zero-write", "error (noncanonical prompt template_id)"],
      "U-RP9": ["zero-write", "error (unknown repository language)", "continue"],
      "U-RP10": ["config language", "mixed-language-manifest"],
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
    };
    for (const [id, tokens] of Object.entries(updateRows)) {
      expectMatrixRow(update, id, tokens);
    }
    for (const [id, tokens] of Object.entries(langRows)) {
      expectMatrixRow(lang, id, tokens);
    }

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
});
