import type { ImplementFlowDependencies, ImplementFlowResult } from "../run-implement-flow.js";
export declare const implementToolName = "codex_implement";
export declare const implementToolSchema: {
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
            files_allowlist: {
                type: string;
                items: {
                    type: string;
                };
            };
            work_order: {
                type: string;
            };
            dispatch_key: {
                type: string;
            };
            previous_findings: {};
        };
        required: string[];
    };
};
export declare function handleImplement(deps: ImplementFlowDependencies, rawInput: unknown, signal?: AbortSignal): Promise<ImplementFlowResult>;
//# sourceMappingURL=implement.d.ts.map