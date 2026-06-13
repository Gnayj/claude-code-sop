// Shared test fixtures.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedConfig } from "../src/config.js";
import type { CodexClient } from "../src/codex-client.js";
import type { ReviewProvider } from "../src/review-provider.js";
import { CodexProvider } from "../src/providers/codex.js";
import type {
  Conclusion,
  ReviewEnvelope,
  ReviewStage,
  VerdictFactors,
  AnyVerdict,
} from "../src/types.js";

/**
 * Wrap a (mock) CodexClient in a CodexProvider for run-review-flow tests. The mock's
 * startThread ignores workingDirectory, so the value is irrelevant here. This is the
 * §8.3 equivalence harness: the SAME flow tests that validated the pre-abstraction
 * direct-codex path now exercise CodexProvider, asserting identical thread reuse /
 * force_new_thread / context behaviour through the provider boundary.
 */
export function makeCodexProvider(
  codex: CodexClient,
  workingDirectory = "/tmp/ccsop-test-wd",
): ReviewProvider {
  return new CodexProvider(codex, { workingDirectory });
}

export function makeTempDir(prefix = "codex-review-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function rmDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function defaultConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    meta: {
      project_id: "test-project",
      project_name: "test",
      language: "zh-CN",
      repo_root: ".",
      allowed_doc_roots: ["docs/", ".codex-review/templates/"],
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
    state: {
      lock_timeout_seconds: 5,
      session_retention_days: 90,
      backlog_retention_days: 180,
    },
    circuit_breakers: {
      max_design_review_rounds: 3,
      max_code_review_rounds: 3,
      max_fix_review_rounds: 3,
      scope_drift_lines_threshold: 200,
      context_warn_pct: 0.6,
      context_force_new_thread_pct: 0.8,
      codex_failure_streak_threshold: 3,
      parser_failure_streak_threshold: 3,
      design_mechanical_max_sections: 8,
      code_mechanical_max_fix_lines: 100,
      code_mechanical_max_modules: 1,
    },
    safety: { extra_danger_verbs_regex: "" },
    review: {
      provider: "codex",
      design: {
        prompt_template: ".codex-review/templates/design-review.md.tpl",
        verdict_enum: ["Go", "Go-after-fixes", "Rereview-after-fixes", "No-Go"],
        trigger_clauses: "claude-code-sop-collaboration.md#4.5",
      },
      code: {
        prompt_template: ".codex-review/templates/code-review.md.tpl",
        verdict_enum: ["Pass", "Pass-after-fixes", "Rereview-after-fixes", "No-Go"],
        rule_sections: ["9.A", "9.B", "9.C"],
      },
      fix: {
        prompt_template: ".codex-review/templates/fix-review.md.tpl",
        verdict_enum: [
          "All-fixed",
          "Partial",
          "New-issues",
          "Rereview-after-fixes",
          "No-Go",
        ],
      },
      codex: { model: "", effort: "" },
      claude: { model: "", max_tokens: 16000, key_env: "ANTHROPIC_API_KEY", context_window: 200000 },
      manual: { sessions_dir: "" },
    },
    codex: { default_model: "" },
    ...overrides,
  };
}

export function defaultFactors(over: Partial<VerdictFactors> = {}): VerdictFactors {
  return {
    critical_count: 0,
    important_count: 0,
    affected_major_sections_count: 0,
    has_open_design_decision: false,
    has_new_arch_concept: false,
    has_interdependent_rc: false,
    estimated_fix_lines: 0,
    touched_module_count: 0,
    has_design_gap: false,
    ...over,
  };
}

export function makeConclusion(
  level: "Critical" | "Important" | "Suggestion",
  over: Partial<Conclusion> = {},
): Conclusion {
  return {
    conclusion_id: `c_${Math.random().toString(36).slice(2, 8)}`,
    level,
    rule: level === "Critical" ? "9.A.1" : "9.B.3",
    target: { kind: "file_line", file: "src/foo.ts", line: 42 },
    evidence: "evidence text",
    fix: "fix text",
    auto_fix_class: level === "Suggestion" ? "manual-only" : "auto",
    ...over,
  } as Conclusion;
}

export function makeEnvelope(
  stage: ReviewStage,
  verdict: AnyVerdict,
  over: Partial<ReviewEnvelope> = {},
): ReviewEnvelope {
  return {
    thread_id: "thr_test",
    review_id: `rev_test_${stage}_1_abcd`,
    design_id: "test-design",
    stage,
    review_round: 1,
    verdict,
    verdict_factors: defaultFactors(),
    conclusions: [],
    open_questions: [],
    tokens_used_estimate: 100,
    context_usage_pct: 0.1,
    compact_summary_for_round: "summary",
    next_action: "ready-to-implement",
    rejected_by_parser: [],
    ...over,
  };
}
