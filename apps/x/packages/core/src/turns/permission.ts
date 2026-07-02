import type { z } from "zod";
import type { ConversationMessage, JsonValue } from "@x/shared/dist/turns.js";

export interface PermissionCheckInput {
    turnId: string;
    toolCallId: string;
    toolId: string;
    toolName: string;
    input: unknown;
}

export interface PermissionCheckAllowed {
    required: false;
}

export interface PermissionCheckRequired {
    required: true;
    // Presentation payload persisted on tool_permission_required and shown to
    // the human/classifier.
    request: JsonValue;
}

// Tool-specific policy (command analysis, filesystem boundaries, allowlists)
// lives behind this seam, outside the loop. A thrown error fails closed: the
// call is recorded as permission-required and never executes automatically.
export interface IPermissionChecker {
    check(
        input: PermissionCheckInput,
    ): Promise<PermissionCheckAllowed | PermissionCheckRequired>;
}

export interface PermissionClassificationInput {
    toolCallId: string;
    toolName: string;
    input: unknown;
    request: JsonValue;
}

export interface PermissionClassification {
    toolCallId: string;
    decision: "allow" | "deny" | "defer";
    reason: string;
}

export interface PermissionClassificationBatch {
    turnId: string;
    // Conversation context for the classifier: the turn's resolved context
    // plus current-turn settled messages.
    messages: Array<z.infer<typeof ConversationMessage>>;
    requests: PermissionClassificationInput[];
}

// Handles all permission-required calls from one model response in one batch
// when automatic permission is enabled. Internal model calls are opaque to
// the turn loop. Failures and omitted decisions normalize to defer.
export interface IPermissionClassifier {
    classify(
        batch: PermissionClassificationBatch,
        signal: AbortSignal,
    ): Promise<PermissionClassification[]>;
}
