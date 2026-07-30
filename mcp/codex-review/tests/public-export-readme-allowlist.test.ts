import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

function maintainedReadmes(): string[] {
  return readdirSync(resolve(root, "templates/i18n"), {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        existsSync(
          resolve(
            root,
            "templates/i18n",
            entry.name,
            "i18n-manifest.json",
          ),
        ),
    )
    .map((entry) => `README.${entry.name}.md`)
    .sort();
}

describe("public export README allowlist", () => {
  it("keeps every manifest-derived maintained README in the shipped top-level layout", () => {
    const script = readFileSync(resolve(root, "scripts/sync-public.sh"), "utf8");
    const expectedAssignment = script.match(
      /^EXPECTED="\$\(printf '%s\\n'[\s\S]*?\| sort\)"$/m,
    )?.[0];
    expect(expectedAssignment, "sync-public EXPECTED allowlist").toBeDefined();
    const readmes = maintainedReadmes();
    expect(readmes).toEqual([
      "README.de-DE.md",
      "README.zh-CN.md",
    ]);
    expect(
      expectedAssignment?.match(/\bREADME(?:\.[A-Za-z0-9-]+)?\.md\b/g)?.sort(),
    ).toEqual(["README.md", ...readmes].sort());
  });
});
