import { z } from "zod";
import {
    AssistantMessage,
    MessageList,
    ToolCallPart,
} from "@x/shared/dist/message.js";

// ─── Persisted fact schemas ─────────────────────────────────────────────────
//
// A turn is five append-only fact logs + set-once scalars. Records are never
// mutated or deleted; every field records exactly one non-derivable fact.
// Everything else (status, per-call lifecycle) is derived.

export const PermissionRequest = z.object({
    toolCallId: z.string(),
    // What the user is approving (file access, command, ...). Computed from
    // tool args by the PermissionGate, so it must be persisted to pin down
    // exactly what was asked.
    request: z.unknown(),
    requestedAt: z.string(),
});

export const PermissionDecision = z.discriminatedUnion("decidedBy", [
    z.object({
        toolCallId: z.string(),
        decidedBy: z.literal("user"),
        decision: z.enum(["granted", "denied"]),
        reason: z.string().nullable(),
        decidedAt: z.string(),
    }),
    z.object({
        toolCallId: z.string(),
        decidedBy: z.literal("classifier"),
        decision: z.enum(["granted", "denied", "abstained"]),
        reason: z.string(),
        decidedAt: z.string(),
    }),
]);

export const StartedTool = z.object({
    toolCallId: z.string(),
    startedAt: z.string(),
});

export const DispatchedTool = z.object({
    toolCallId: z.string(),
    dispatchedAt: z.string(),
});

export const AgentLoopError = z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
    at: z.string(),
});

export const PermissionMode = z.enum(["manual", "auto"]);

export const AgentLoopTurn = z.object({
    id: z.string(),
    agentId: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    permissionMode: PermissionMode,

    // append-only fact logs
    messages: MessageList,
    permissionRequests: z.array(PermissionRequest),
    permissionDecisions: z.array(PermissionDecision),
    startedTools: z.array(StartedTool),
    dispatchedTools: z.array(DispatchedTool),

    // set-once scalars
    error: AgentLoopError.nullable(),
    completedAt: z.string().nullable(),

    createdAt: z.string(),
    updatedAt: z.string(),
});

export const AgentLoopInput = z.object({
    agentId: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    permissionMode: PermissionMode.optional(),
    // May include prior-conversation history; turns are self-contained by design.
    messages: MessageList.min(1),
});

// ─── Tool definitions (environment, not turn state) ────────────────────────

export type ToolDefinition = {
    name: string;
    description?: string;
    // JSON Schema for the tool input
    inputSchema?: unknown;
};

// ─── Live (never persisted) event types ─────────────────────────────────────

export type ModelStreamEvent =
    | { type: "text-delta"; delta: string }
    | { type: "reasoning-delta"; delta: string }
    | { type: "tool-call"; toolCall: z.infer<typeof ToolCallPart> }
    | { type: "finish"; message: z.infer<typeof AssistantMessage> }
    | { type: "error"; error: unknown };

export type TurnEvent =
    | ModelStreamEvent
    | { type: "tool-execution-start"; toolCallId: string }
    | { type: "tool-result"; toolCallId: string }
    | { type: "permission-requested"; toolCallId: string };

// ─── Derived state ──────────────────────────────────────────────────────────

export type TurnStatus = "waiting" | "completed" | "error" | "idle";

export type ToolCallState =
    | "resolved"            // matching ToolMessage exists — terminal
    | "dispatched"          // delegated; result arrives via setToolResult
    | "interrupted"         // started but never resolved nor dispatched (crash/abort)
    | "needs-classifier"    // open request, auto mode, classifier has not spoken
    | "awaiting-user"       // open request, waiting on a user decision
    | "cleared"             // terminal `granted` decision; ready to execute
    | "unevaluated";        // no facts yet; permission gate has not been consulted

export function toolCallParts(
    turn: z.infer<typeof AgentLoopTurn>,
): z.infer<typeof ToolCallPart>[] {
    const parts: z.infer<typeof ToolCallPart>[] = [];
    for (const msg of turn.messages) {
        if (msg.role !== "assistant" || typeof msg.content === "string") continue;
        for (const part of msg.content) {
            if (part.type === "tool-call") parts.push(part);
        }
    }
    return parts;
}

export function resolvedToolCallIds(turn: z.infer<typeof AgentLoopTurn>): Set<string> {
    const ids = new Set<string>();
    for (const msg of turn.messages) {
        if (msg.role === "tool") ids.add(msg.toolCallId);
    }
    return ids;
}

export function unresolvedToolCalls(
    turn: z.infer<typeof AgentLoopTurn>,
): z.infer<typeof ToolCallPart>[] {
    const resolved = resolvedToolCallIds(turn);
    return toolCallParts(turn).filter((part) => !resolved.has(part.toolCallId));
}

export function deriveToolCallState(
    turn: z.infer<typeof AgentLoopTurn>,
    toolCallId: string,
): ToolCallState {
    if (resolvedToolCallIds(turn).has(toolCallId)) return "resolved";
    if (turn.dispatchedTools.some((t) => t.toolCallId === toolCallId)) return "dispatched";
    if (turn.startedTools.some((t) => t.toolCallId === toolCallId)) return "interrupted";

    const request = turn.permissionRequests.find((r) => r.toolCallId === toolCallId);
    if (request) {
        const decisions = turn.permissionDecisions.filter((d) => d.toolCallId === toolCallId);
        const terminal = decisions.find((d) => d.decision === "granted" || d.decision === "denied");
        if (terminal) {
            // A denied call always has its denial ToolMessage appended atomically
            // with the decision, so an unresolved terminal decision should be
            // `granted` — but check explicitly: an unpaired denial (a buggy
            // future writer) must never derive as executable. It falls back to
            // awaiting-user, which self-heals via a fresh decision.
            return terminal.decision === "granted" ? "cleared" : "awaiting-user";
        }
        if (turn.permissionMode === "auto" && !decisions.some((d) => d.decidedBy === "classifier")) {
            return "needs-classifier";
        }
        return "awaiting-user";
    }

    return "unevaluated";
}

export function deriveTurnStatus(turn: z.infer<typeof AgentLoopTurn>): TurnStatus {
    if (turn.error !== null) return "error";
    if (turn.completedAt !== null) return "completed";
    for (const call of unresolvedToolCalls(turn)) {
        const state = deriveToolCallState(turn, call.toolCallId);
        if (state === "awaiting-user" || state === "dispatched") return "waiting";
    }
    return "idle";
}
