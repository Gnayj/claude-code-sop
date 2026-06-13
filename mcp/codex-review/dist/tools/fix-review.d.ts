import type { FlowDependencies, FlowResult } from "../run-review-flow.js";
export declare const fixReviewToolName = "codex_fix_review";
export declare const fixReviewToolSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            design_id: {
                type: string;
            };
            task_card_path: {
                type: string;
            };
            design_doc_paths: {
                type: string;
                items: {
                    type: string;
                };
            };
            module_doc_paths: {
                type: string;
                items: {
                    type: string;
                };
            };
            handoff_path: {
                type: string;
            };
            fix_diff_spec: {
                type: string;
            };
            changed_files: {
                type: string;
                items: {
                    type: string;
                };
            };
            fix_diff_lines: {
                type: string;
            };
            docs_updated: {
                type: string;
                items: {
                    type: string;
                };
            };
            claude_output: {
                type: string;
            };
            claude_fix_notes: {
                type: string;
            };
            previous_round_id: {
                type: string;
            };
            previous_round_conclusions: {
                type: string;
            };
            applied_fixes: {
                type: string;
            };
            tests_run: {
                type: string;
                items: {
                    type: string;
                };
            };
            validation_evidence: {
                type: string;
            };
            force_new_thread: {
                type: string;
            };
            manual_verdict_path: {
                type: string;
            };
        };
        required: string[];
    };
};
export declare function handleFixReview(deps: FlowDependencies, rawInput: unknown): Promise<FlowResult>;
//# sourceMappingURL=fix-review.d.ts.map