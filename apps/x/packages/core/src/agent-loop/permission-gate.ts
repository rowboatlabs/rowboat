import { z } from "zod";
import { ToolCallPart } from "@x/shared/dist/message.js";
import type { AgentLoopTurn } from "./types.js";

export type PermissionCheckResult =
    | { required: false }
    | { required: true; request: unknown };

export type PermissionClassification = {
    decision: "granted" | "denied" | "abstained";
    reason: string;
};

// Decides whether a tool call needs user approval, and (in auto mode)
// classifies it. Both methods receive the current turn snapshot: the real
// implementation needs turn.sessionId (to consult session-scoped grants) and
// turn.messages (the classifier judges intent against the conversation). The
// real implementation (bridging getToolPermissionMetadata /
// classifyToolPermissions) is integration-phase work; v1 uses fakes in tests.
export interface PermissionGate {
    check(
        toolCall: z.infer<typeof ToolCallPart>,
        turn: z.infer<typeof AgentLoopTurn>,
    ): Promise<PermissionCheckResult>;
    classify(
        toolCall: z.infer<typeof ToolCallPart>,
        request: unknown,
        turn: z.infer<typeof AgentLoopTurn>,
    ): Promise<PermissionClassification>;
}
