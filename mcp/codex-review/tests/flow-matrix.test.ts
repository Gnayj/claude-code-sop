// Flow-matrix tests (collaboration.md §1.D, design ccsop-flow-matrix).
//
// Covers: providerKindForStage derivation (4 flows × design/code), the legacy regression
// pinned by design r1 c_legacy_owner_presence (no owner keys → review.provider governs all
// stages, absence observable), manual short-circuit, loud schema failure on invalid owner
// values, fix-stage inheritance of the session's provider_kind, and the per-stage
// provider_switch rebuild within one design_id (counters preserved).

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigSchema } from "../src/config.js";
import { counterpartOf, providerKindForStage } from "../src/providers/factory.js";
import { runReviewFlow } from "../src/run-review-flow.js";
import { BreakerEngine, initialBreakerState } from "../src/circuit-breakers.js";
import { PromptRenderer } from "../src/prompt-renderer.js";
import { ThreadManager } from "../src/thread-manager.js";
import type {
  ProviderRunResult,
  ProviderSession,
  ReviewProvider,
} from "../src/review-provider.js";
import type { ProviderKind, ReviewStage } from "../src/types.js";
import { defaultConfig, makeEnvelope, makeTempDir, rmDir } from "./test-helpers.js";

// ---------- fakes ----------

function fakeProvider(kind: ProviderKind, replyText: string): ReviewProvider {
  return {
    kind,
    async openSession(stage: ReviewStage, designId: string, prior?): Promise<ProviderSession> {
      return {
        kind,
        designId,
        stage,
        externalSessionId: prior?.external_session_id ?? "",
      };
    },
    async runTurn(): Promise<ProviderRunResult> {
      return {
        kind: "turn",
        text: replyText,
        usage: { input: 10, output: 10, total: 20 },
        provider_session_id: `sess-${kind}`,
      };
    },
    closeSession() {
      /* stateless */
    },
  };
}

/** providerFor spy: records every kind the flow requests. */
function spyRegistry(replyByKind: Partial<Record<ProviderKind, string>>) {
  const requested: ProviderKind[] = [];
  const cache = new Map<ProviderKind, ReviewProvider>();
  const providerFor = (kind: ProviderKind): ReviewProvider => {
    requested.push(kind);
    let p = cache.get(kind);
    if (!p) {
      const reply = replyByKind[kind];
      if (reply === undefined) throw new Error(`no fake reply for kind=${kind}`);
      p = fakeProvider(kind, reply);
      cache.set(kind, p);
    }
    return p;
  };
  return { requested, providerFor };
}

function setupTempProject() {
  const root = makeTempDir("ccsop-flowmatrix-");
  mkdirSync(join(root, ".codex-review/sessions"), { recursive: true });
  mkdirSync(join(root, ".codex-review/archive"), { recursive: true });
  mkdirSync(join(root, ".codex-review/templates"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const name of ["design-review", "code-review", "fix-review"]) {
    writeFileSync(
      join(root, `.codex-review/templates/${name}.md.tpl`),
      `# ${name} tpl\n{{design_id}}\n`,
      "utf8",
    );
  }
  writeFileSync(join(root, "docs/d.md"), "design content", "utf8");
  const config = defaultConfig({
    meta: {
      project_id: "fm-test",
      project_name: "fm-test",
      language: "en",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
    },
  });
  const tm = new ThreadManager({
    sessionsDir: join(root, ".codex-review/sessions"),
    archiveDir: join(root, ".codex-review/archive"),
    lockTimeoutSeconds: 2,
  });
  return {
    root,
    config,
    tm,
    renderer: new PromptRenderer(config, root),
    breakers: new BreakerEngine(config),
    cleanup: () => rmDir(root),
  };
}

function flowInput(stage: ReviewStage, designId: string) {
  return {
    stage,
    designId,
    designDocPaths: ["docs/d.md"],
    fileBlocks: [],
    promptVars: { design_id: designId },
    hasPreviousRoundResolved: stage === "fix",
    forceNewThread: false,
  };
}

// ---------- derivation unit ----------

describe("providerKindForStage (§1.D derivation)", () => {
  it("legacy regression (c_legacy_owner_presence): both owner keys absent → review.provider governs every stage", () => {
    for (const globalProvider of ["codex", "claude"] as const) {
      const config = defaultConfig();
      config.review.provider = globalProvider;
      config.collaboration = {};
      for (const stage of ["design", "code", "fix"] as const) {
        expect(providerKindForStage(stage, config)).toBe(globalProvider);
      }
    }
  });

  it("derives the counterpart per stage for all 4 flows", () => {
    const cases: Array<{
      design_owner: "claude" | "codex";
      implement_owner: "claude" | "codex";
      design: ProviderKind;
      code: ProviderKind;
    }> = [
      { design_owner: "claude", implement_owner: "claude", design: "codex", code: "codex" },
      { design_owner: "claude", implement_owner: "codex", design: "codex", code: "claude" },
      { design_owner: "codex", implement_owner: "codex", design: "claude", code: "claude" },
      { design_owner: "codex", implement_owner: "claude", design: "claude", code: "codex" },
    ];
    for (const c of cases) {
      const config = defaultConfig();
      config.collaboration = {
        design_owner: c.design_owner,
        implement_owner: c.implement_owner,
      };
      expect(providerKindForStage("design", config)).toBe(c.design);
      expect(providerKindForStage("code", config)).toBe(c.code);
      // fix (no-session fallback) mirrors the code stage.
      expect(providerKindForStage("fix", config)).toBe(c.code);
    }
  });

  it("a single present key activates derivation; the missing key resolves claude", () => {
    const config = defaultConfig();
    config.review.provider = "claude"; // must be ignored once derivation is active
    config.collaboration = { design_owner: "codex" };
    expect(providerKindForStage("design", config)).toBe("claude");
    expect(providerKindForStage("code", config)).toBe(counterpartOf("claude"));
  });

  it("review.provider=manual short-circuits every stage even with owner keys present", () => {
    const config = defaultConfig();
    config.review.provider = "manual";
    config.collaboration = { design_owner: "codex", implement_owner: "codex" };
    for (const stage of ["design", "code", "fix"] as const) {
      expect(providerKindForStage(stage, config)).toBe("manual");
    }
  });
});

// ---------- config schema ----------

describe("[collaboration] schema (presence-observable, loud on invalid)", () => {
  const minimalRaw = () => ({
    meta: {
      project_id: "p",
      project_name: "p",
      repo_root: ".",
      allowed_doc_roots: ["docs/"],
    },
    paths: {
      sop: "docs/sop.md",
      collaboration_sop: "docs/collab.md",
      handoff: "docs/handoff.md",
      plans_active: "docs/plans/active",
      plans_completed: "docs/plans/completed",
      sessions_dir: ".codex-review/sessions",
      backlog_dir: ".codex-review/backlog",
      archive_dir: ".codex-review/archive",
    },
    review: {
      design: { prompt_template: "t", verdict_enum: ["Go", "No-Go"] },
      code: { prompt_template: "t", verdict_enum: ["Pass", "No-Go"] },
      fix: { prompt_template: "t", verdict_enum: ["All-fixed", "No-Go"] },
    },
  });

  it("no [collaboration] table → parses with both owners undefined (absence observable)", () => {
    const parsed = ConfigSchema.parse(minimalRaw());
    expect(parsed.collaboration.design_owner).toBeUndefined();
    expect(parsed.collaboration.implement_owner).toBeUndefined();
  });

  it("accepts owners + the operational autonomy passthrough", () => {
    const parsed = ConfigSchema.parse({
      ...minimalRaw(),
      collaboration: { autonomy: "gated", design_owner: "codex", implement_owner: "claude" },
    });
    expect(parsed.collaboration.design_owner).toBe("codex");
    expect(parsed.collaboration.implement_owner).toBe("claude");
  });

  it("an invalid owner value fails loud (schema error → server degraded), never a silent fallback", () => {
    expect(() =>
      ConfigSchema.parse({
        ...minimalRaw(),
        collaboration: { design_owner: "codx" },
      }),
    ).toThrow();
  });
});

// ---------- flow-level ----------

const designReply = JSON.stringify(makeEnvelope("design", "Go"));
const codeReply = JSON.stringify(makeEnvelope("code", "Pass"));
const fixReply = JSON.stringify(makeEnvelope("fix", "All-fixed"));

describe("per-stage providers within one design_id (§1.D)", () => {
  it("design→code reviewer change rebuilds the session (provider_switch) and preserves round counters", async () => {
    const { root, config, tm, renderer, breakers, cleanup } = setupTempProject();
    try {
      // Flow claude+codex: design review ← codex, code review ← claude.
      config.collaboration = { design_owner: "claude", implement_owner: "codex" };
      const { requested, providerFor } = spyRegistry({
        codex: designReply,
        claude: codeReply,
      });
      const deps = {
        config,
        configBaseDir: root,
        providerFor,
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState: initialBreakerState(),
      };

      const d = await runReviewFlow(deps, flowInput("design", "fm-d"));
      expect(d.ok).toBe(true);
      expect(requested).toEqual(["codex"]);
      let state = tm.read("fm-d");
      expect(state?.provider_kind).toBe("codex");
      expect(state?.rounds.design_review).toBe(1);

      const c = await runReviewFlow(deps, flowInput("code", "fm-d"));
      expect(c.ok).toBe(true);
      expect(requested).toEqual(["codex", "claude"]);
      state = tm.read("fm-d");
      // provider_switch rebuild: new session kind, old thread archived into thread_history,
      // design-round counter preserved across the boundary.
      expect(state?.provider_kind).toBe("claude");
      expect(state?.thread_history?.length).toBe(1);
      expect(state?.thread_history?.[0]?.reason).toBe("provider_switch");
      expect(state?.rounds.design_review).toBe(1);
      expect(state?.rounds.code_review).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fix under review.provider=manual short-circuits to manual even with a live non-manual session (i_fix_manual_short_circuit)", async () => {
    const { root, config, tm, renderer, breakers, cleanup } = setupTempProject();
    try {
      // 1) Code review under legacy codex → session provider_kind = codex.
      config.review.provider = "codex";
      const first = spyRegistry({ codex: codeReply });
      const deps1 = {
        config,
        configBaseDir: root,
        providerFor: first.providerFor,
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState: initialBreakerState(),
      };
      const c = await runReviewFlow(deps1, flowInput("code", "fm-manual"));
      expect(c.ok).toBe(true);
      expect(tm.read("fm-manual")?.provider_kind).toBe("codex");

      // 2) Repo switched to manual delivery. The fix must NOT inherit the codex session —
      //    manual outranks inheritance, via the provider_switch rebuild.
      config.review.provider = "manual";
      const second = spyRegistry({ manual: fixReply });
      const deps2 = { ...deps1, providerFor: second.providerFor };
      const f = await runReviewFlow(deps2, flowInput("fix", "fm-manual"));
      expect(f.ok).toBe(true);
      expect(second.requested).toEqual(["manual"]);
      const state = tm.read("fm-manual");
      expect(state?.provider_kind).toBe("manual");
      expect(state?.thread_history?.length).toBe(1);
      expect(state?.thread_history?.[0]?.reason).toBe("provider_switch");
    } finally {
      cleanup();
    }
  });

  it("fix INHERITS the session's provider_kind over config derivation (reviewer who raised the findings re-judges)", async () => {
    const { root, config, tm, renderer, breakers, cleanup } = setupTempProject();
    try {
      // 1) Code review under flow claude+codex → session provider_kind = claude.
      config.collaboration = { design_owner: "claude", implement_owner: "codex" };
      const first = spyRegistry({ claude: codeReply });
      const deps1 = {
        config,
        configBaseDir: root,
        providerFor: first.providerFor,
        threadManager: tm,
        promptRenderer: renderer,
        breakers,
        breakerState: initialBreakerState(),
      };
      const c = await runReviewFlow(deps1, flowInput("code", "fm-fix"));
      expect(c.ok).toBe(true);
      expect(tm.read("fm-fix")?.provider_kind).toBe("claude");

      // 2) Config flips back to legacy (owners removed, global provider=codex). Derivation
      //    would say codex — but fix must inherit the live session's claude.
      config.collaboration = {};
      config.review.provider = "codex";
      const second = spyRegistry({ claude: fixReply });
      const deps2 = { ...deps1, providerFor: second.providerFor };
      const f = await runReviewFlow(deps2, flowInput("fix", "fm-fix"));
      expect(f.ok).toBe(true);
      expect(second.requested).toEqual(["claude"]);
      const state = tm.read("fm-fix");
      expect(state?.provider_kind).toBe("claude");
      // Inheritance means NO provider_switch rebuild on the fix call.
      expect(state?.thread_history ?? []).toHaveLength(0);
      expect(state?.rounds.fix_review).toBe(1);
    } finally {
      cleanup();
    }
  });
});
