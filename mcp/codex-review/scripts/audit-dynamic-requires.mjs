// Static half of the dynamic-require audit gate (design ccsop-bridge-deps-lifecycle §8.2).
//
// The bundle's `createRequire` banner is needed for deps that call `require()` dynamically (e.g.
// @iarna/toml → require("stream")). The risk it introduces: a bundled dep that dynamically
// require()s a *package* would silently look for it in `node_modules` beside dist/server.js —
// reintroducing the exact runtime-dependency failure this card removes, invisibly.
//
// Correct static signal = esbuild's METAFILE, not a regex over the bundle source. (A regex for
// `require("x")` false-positives on code that emits require() *as a string* — ajv's standalone
// codegen templates embed literal `require("ajv/dist/runtime/equal")` strings that are never
// eval'd at runtime.) Two facts give the static guarantee:
//   1. `npm run bundle` exiting 0 means esbuild resolved and inlined every STATIC import/require;
//      an unresolvable package require is a hard build error, not a silent survivor.
//   2. The metafile lists zero non-builtin EXTERNAL imports in the output — nothing was left to be
//      resolved from node_modules at runtime.
// What remains uncatchable statically is a COMPUTED `require(expr)`; that is exactly why design
// §8.2 also mandates a clean-tree runtime fixture. Static pass is necessary, not sufficient.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const metaPath = path.join(pkgRoot, "dist/server.meta.json");

let meta;
try {
  meta = JSON.parse(await readFile(metaPath, "utf8"));
} catch {
  console.error(
    `[audit-dynamic-requires] FAIL — ${path.relative(pkgRoot, metaPath)} missing. ` +
      `Run \`npm run bundle\` first (it writes the metafile).`,
  );
  process.exit(1);
}

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);
const isBuiltin = (p) => builtins.has(p) || builtins.has(p.replace(/^node:/, ""));

const outputs = Object.values(meta.outputs ?? {});
const offenders = [];

for (const out of outputs) {
  for (const imp of out.imports ?? []) {
    if (imp.external && !isBuiltin(imp.path)) offenders.push(imp.path);
  }
}
// Positive confirmation: the runtime deps we expect to be INLINED must appear as bundled inputs.
const inputs = Object.keys(meta.inputs ?? {});
const inputCount = inputs.length;
const mustBeBundled = ["@modelcontextprotocol/sdk", "@iarna/toml", "@openai/codex-sdk", "zod"];
const notBundled = mustBeBundled.filter(
  (dep) => !inputs.some((i) => i.includes(`node_modules/${dep}/`)),
);

if (offenders.length > 0) {
  console.error(
    "[audit-dynamic-requires] FAIL — bundle output has non-builtin external import(s):",
  );
  for (const o of new Set(offenders)) console.error(`  - ${o}`);
  console.error(
    "Each must be bundled, externalized with a stated lifecycle path, or fail with a legible " +
      "tool-level error (design §8.2). It must not silently need node_modules beside the bundle.",
  );
  process.exit(1);
}

if (notBundled.length > 0) {
  console.error(
    "[audit-dynamic-requires] FAIL — expected runtime deps not found inlined in the bundle:",
  );
  for (const d of notBundled) console.error(`  - ${d} (did it get externalized by mistake?)`);
  process.exit(1);
}

console.log(
  `[audit-dynamic-requires] PASS — ${inputCount} inputs inlined, 0 non-builtin external imports. ` +
    `(@openai/codex remains a deliberate runtime resolution — see the §4.1 chain; runtime fixture covers it.)`,
);
