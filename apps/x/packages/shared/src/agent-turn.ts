import { z } from "zod";
import {
    AssistantMessage,
    CodeMode,
    Message,
    MessageList,
    ToolCallPart,
    VoiceOutputMode,
} from "./message.js";
import { ApprovalPolicy, CodeRunEvent, PermissionAsk } from "./code-mode.js";

// ─── Persisted fact schemas ─────────────────────────────────────────────────
//
// A turn is five append-only fact logs + set-once scalars. Records are never
// mutated or deleted; every field records exactly one non-derivable fact.
// Everything else (status, per-call lifecycle) is derived.
//
// This is the cross-boundary contract for the new runtime (like runs.ts was for
// the old one): core persists/derives it, the IPC layer ships it, the renderer
// renders it. Pure (zod + message schemas) so it is safe to import in the
// browser-side renderer.

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

// One entry per model call. Token counts are as reported by the provider —
// null when the provider did not report that field. Aggregate via totalUsage.
export const ModelUsage = z.object({
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    reasoningTokens: z.number().nullable(),
    cachedInputTokens: z.number().nullable(),
    at: z.string(),
});

export const AgentLoopError = z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
    at: z.string(),
});

export const PermissionMode = z.enum(["manual", "auto"]);

// Per-turn compose chips that shape the system prompt and tool routing.
// Middle-pane context is NOT here — it rides on the user message
// (UserMessage.userMessageContext), captured fresh at send time.
export const ComposeContext = z.object({
    voiceInput: z.boolean().optional(),
    voiceOutput: VoiceOutputMode.optional(),
    searchEnabled: z.boolean().optional(),
    codeMode: CodeMode.optional(),
    // Code-section (rowboat) turns pin the coding agent's working directory and
    // approval policy; code_agent_run honors these over the model's args.
    codeCwd: z.string().optional(),
    codePolicy: ApprovalPolicy.optional(),
});

export const AgentLoopTurn = z.object({
    id: z.string(),
    agentId: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    permissionMode: PermissionMode,

    // Analytics attribution for this turn's LLM usage (the PostHog `llm_usage`
    // event). Opaque strings here — values come from core's UseCase taxonomy
    // (e.g. "copilot_chat", "live_note_agent", "knowledge_sync"). null when the
    // turn isn't attributed. Also installed into the async-local use-case context
    // so nested LLM calls (permission classifier, builtin tools) inherit it.
    useCase: z.string().nullable(),
    subUseCase: z.string().nullable(),

    // Session linkage — opaque to the loop (the sessions layer owns the
    // meaning). seq is the turn's 1-based position within its session.
    sessionId: z.string().nullable(),
    sessionSeq: z.number().int().positive().nullable(),

    // Per-turn compose chips (voice / search / code-mode); null when none.
    // Read by the SystemComposer and (codeMode) the tool runner.
    composeContext: ComposeContext.nullable(),

    // append-only fact logs
    messages: MessageList,
    permissionRequests: z.array(PermissionRequest),
    permissionDecisions: z.array(PermissionDecision),
    startedTools: z.array(StartedTool),
    dispatchedTools: z.array(DispatchedTool),
    modelUsage: z.array(ModelUsage),

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
    useCase: z.string().nullable().optional(),
    subUseCase: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    sessionSeq: z.number().int().positive().nullable().optional(),
    composeContext: ComposeContext.nullable().optional(),
    // May include prior-conversation history; turns are self-contained by design.
    messages: MessageList.min(1),
}).refine(
    (input) => (input.sessionId == null) === (input.sessionSeq == null),
    { message: "sessionId and sessionSeq must be set together" },
);

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
    // Incremental output streamed by a tool while it runs (e.g. command stdout,
    // code-agent progress). Live-only and never persisted — the final result is
    // recorded as a ToolMessage; this is purely for the UI to watch in real time.
    | { type: "tool-output"; toolCallId: string; chunk: string }
    | { type: "tool-result"; toolCallId: string }
    | { type: "permission-requested"; toolCallId: string }
    // Rich code-agent activity streamed by code_agent_run (rowboat mode): the
    // ACP agent's tool calls / plan / diffs, and its mid-run approval asks. Both
    // carry the owning tool call id so the UI nests them under that tool card.
    | { type: "code-run-event"; toolCallId: string; event: z.infer<typeof CodeRunEvent> }
    | { type: "code-run-permission-request"; toolCallId: string; requestId: string; ask: z.infer<typeof PermissionAsk> };

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

// The transcript as a successor turn would see it: a terminal turn's dangling
// tool calls are closed out with synthetic ToolMessages so a follow-up never
// re-executes — or hangs on — stale calls. Pure and deterministic over an
// immutable (terminal) turn, which is what lets the sessions layer build the
// next turn's input from it AND lets stores reproduce it byte-for-byte.
export function closedTranscript(
    turn: z.infer<typeof AgentLoopTurn>,
): z.infer<typeof Message>[] {
    const messages = [...turn.messages];
    for (const call of unresolvedToolCalls(turn)) {
        messages.push({
            role: "tool",
            content: closureContent(deriveToolCallState(turn, call.toolCallId)),
            toolCallId: call.toolCallId,
            toolName: call.toolName,
        });
    }
    return messages;
}

// Honest per-state wording for a dangling call: how far did it actually get?
function closureContent(state: ToolCallState): string {
    switch (state) {
        case "interrupted":
            // execution began in-process; the side effect may have landed
            return "Tool execution was interrupted before completing. It may or may not have taken effect; do not assume it ran.";
        case "dispatched":
            // delegated to an external runner; it may still finish out there
            return "Tool was dispatched but its result never arrived; it may have completed externally. Do not assume it ran or that it failed.";
        default:
            // never reached execution (unevaluated / awaiting permission / cleared-but-not-started)
            return "Tool was not executed: the turn was stopped before this call ran.";
    }
}

// Sum of all model calls in the turn. A field is null only if no call
// reported it; otherwise unreported entries count as 0 toward the sum.
export function totalUsage(
    turn: z.infer<typeof AgentLoopTurn>,
): Omit<z.infer<typeof ModelUsage>, "at"> {
    const sum = (field: "inputTokens" | "outputTokens" | "totalTokens" | "reasoningTokens" | "cachedInputTokens") => {
        const reported = turn.modelUsage.map((u) => u[field]).filter((v) => v !== null);
        if (reported.length === 0) return null;
        return reported.reduce((a, b) => a + b, 0);
    };
    return {
        inputTokens: sum("inputTokens"),
        outputTokens: sum("outputTokens"),
        totalTokens: sum("totalTokens"),
        reasoningTokens: sum("reasoningTokens"),
        cachedInputTokens: sum("cachedInputTokens"),
    };
}
