import type { FlowDependencies, FlowResult } from "../run-review-flow.js";
export declare const codeReviewToolName = "codex_code_review";
export declare const codeReviewToolSchema: {
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
            diff_spec: {
                type: string;
            };
            changed_files: {
                type: string;
                items: {
                    type: string;
                };
            };
            claude_output: {
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
            docs_updated: {
                type: string;
                items: {
                    type: string;
                };
            };
            previous_round_id: {
                type: string;
            };
            previous_round_resolved: {
                type: string;
            };
            applied_fixes: {
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
export declare function handleCodeReview(deps: FlowDependencies, rawInput: unknown): Promise<FlowResult>;
//# sourceMappingURL=code-review.d.ts.map