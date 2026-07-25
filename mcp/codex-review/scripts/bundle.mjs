// esbuild single-file bundle for the ccsop review MCP bridge.
//
// Why a bundle (design ccsop-bridge-deps-lifecycle §4.1, Option 5): the plugin cache dir gets a
// fresh, dependency-free copy on every version bump, so a `dist/` that imports from `node_modules`
// dies at startup with a bare `-32000`. A single self-contained file removes 4 of the 5 runtime
// deps and turns the remaining failure (the codex CLI, resolved at runtime) into a legible
// tool-level error instead of a crash.
//
// The `@openai/codex` package is deliberately NOT inlined: `@openai/codex-sdk`'s findCodexPath()
// resolves it at runtime via createRequire(import.meta.url) and spawns a native ELF binary — not
// statically bundlable. The banner below supplies the CJS `require` that esbuild's ESM output
// needs (e.g. `@iarna/toml` does a dynamic `require("stream")`); package-level dynamic requires
// are audited by scripts/audit-dynamic-requires.mjs (design §8.2).

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

const result = await build({
  entryPoints: [path.join(pkgRoot, "src/server.ts")],
  outfile: path.join(pkgRoot, "dist/server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  metafile: true,
  // ESM output needs a CJS `require` for deps that call it dynamically (@iarna/toml → require("stream")).
  // import.meta.url resolves against the emitted bundle, which is also what lets the runtime
  // @openai/codex resolution (link 2 of the design §4.1 chain) find a package installed beside it.
  banner: {
    js: 'import{createRequire as __ccsopRequire}from"module";const require=__ccsopRequire(import.meta.url);',
  },
});

// Emit the metafile for the dynamic-require audit gate (design §8.2). Not published — gitignored.
const { writeFile } = await import("node:fs/promises");
await writeFile(path.join(pkgRoot, "dist/server.meta.json"), JSON.stringify(result.metafile));

console.log("[bundle] dist/server.js written (single-file, node20, esm).");
