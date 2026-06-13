import type { FlowDependencies, FlowResult } from "../run-review-flow.js";
export declare const designReviewToolName = "codex_design_review";
export declare const designReviewToolSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            design_id: {
                type: string;
            };
            design_doc_paths: {
                type: string;
                items: {
                    type: string;
                };
            };
            task_card_path: {
                type: string;
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
            triggers_hit: {
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
            applied_edits: {
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
export declare function handleDesignReview(deps: FlowDependencies, rawInput: unknown): Promise<FlowResult>;
//# sourceMappingURL=design-review.d.ts.map