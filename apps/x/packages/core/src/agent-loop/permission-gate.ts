import { z } from "zod";
import { ToolCallPart } from "@x/shared/dist/message.js";

export type PermissionCheckResult =
    | { required: false }
    | { required: true; request: unknown };

export type PermissionClassification = {
    decision: "granted" | "denied" | "abstained";
    reason: string;
};

// Decides whether a tool call needs user approval, and (in auto mode)
// classifies it. The real implementation (bridging getToolPermissionMetadata /
// classifyToolPermissions) is integration-phase work; v1 uses fakes in tests.
export interface PermissionGate {
    check(toolCall: z.infer<typeof ToolCallPart>): Promise<PermissionCheckResult>;
    classify(
        toolCall: z.infer<typeof ToolCallPart>,
        request: unknown,
    ): Promise<PermissionClassification>;
}
