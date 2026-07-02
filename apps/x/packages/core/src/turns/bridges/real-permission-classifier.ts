import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import { convertFromMessages } from "../../agents/runtime.js";
import type { UseCase } from "../../analytics/use_case.js";
import { classifyToolPermissions } from "../../security/auto-permission-classifier.js";
import type {
    IPermissionClassifier,
    PermissionClassification,
    PermissionClassificationBatch,
} from "../permission.js";

export interface RealPermissionClassifierDeps {
    classifier?: typeof classifyToolPermissions;
    useCase?: UseCase;
}

// Bridges the existing LLM auto-permission classifier. The underlying
// classifier only ever answers allow/deny; omitted decisions surface as
// missing entries, which the turn loop records as classification failures
// and treats as defer. A parse/LLM failure throws, which the loop likewise
// normalizes to defer for the whole batch.
export class RealPermissionClassifier implements IPermissionClassifier {
    private readonly classifier: typeof classifyToolPermissions;
    private readonly useCase: UseCase;

    constructor(deps: RealPermissionClassifierDeps = {}) {
        this.classifier = deps.classifier ?? classifyToolPermissions;
        this.useCase = deps.useCase ?? "copilot_chat";
    }

    async classify(
        batch: PermissionClassificationBatch,
    ): Promise<PermissionClassification[]> {
        if (batch.requests.length === 0) {
            return [];
        }
        const decisions = await this.classifier({
            runId: batch.turnId,
            agentName: null,
            messages: convertFromMessages(batch.messages),
            candidates: batch.requests.map((request) => ({
                toolCall: {
                    type: "tool-call",
                    toolCallId: request.toolCallId,
                    toolName: request.toolName,
                    arguments: request.input,
                },
                permission: ToolPermissionMetadata.parse(request.request),
            })),
            useCase: this.useCase,
        });
        return decisions.map((decision) => ({
            toolCallId: decision.toolCallId,
            decision: decision.decision,
            reason: decision.reason,
        }));
    }
}
