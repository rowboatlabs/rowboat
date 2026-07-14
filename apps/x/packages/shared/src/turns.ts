import { z } from "zod";
import {
    AssistantMessage,
    ToolCallPart,
    ToolMessage,
    UserMessage,
} from "./message.js";
import { ReasoningEffort } from "./models.js";

// Durable turn contract for the turn runtime (see
// packages/core/docs/turn-runtime-design.md). This module is the
// cross-boundary source of truth shared by core and renderer: event schemas,
// the pure reducer, and pure derivations over the reduced state. It must
// stay free of I/O and node-only imports so the renderer can consume it
// directly.

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

export const DEFAULT_MAX_MODEL_CALLS = 20;
export const MODEL_CALL_LIMIT_ERROR_CODE = "model-call-limit";

// ---------------------------------------------------------------------------
// Agent snapshot
// ---------------------------------------------------------------------------

export const ModelDescriptor = z.object({
    provider: z.string(),
    model: z.string(),
});

export const AgentByIdRequest = z.object({
    agentId: z.string(),
    overrides: z
        .object({
            model: ModelDescriptor.optional(),
            // Opaque composition hints interpreted by the agent resolver
            // (e.g. work-dir id, voice/search/code modes). Persisted verbatim
            // for audit. The resolver decides which keys affect the system
            // prompt; keeping prompt-affecting inputs session-sticky is what
            // preserves provider prefix caching across turns.
            composition: z.json().optional(),
        })
        .optional(),
});

// An agent constructed at request time (sub-agents spawned by a parent turn).
// Persisted verbatim in turn_created.agent.requested, so the definition
// self-documents in the turn file; the resolver materializes it into the same
// immutable ResolvedAgent snapshot as a stored agent.
export const InlineAgentSpec = z.object({
    name: z.string(),
    instructions: z.string(),
    model: ModelDescriptor.optional(),
    // Builtin tool names; resolution validates against the live catalog and
    // substitutes the default headless profile when omitted.
    tools: z.array(z.string()).optional(),
});

export const InlineAgentRequest = z.object({
    inline: InlineAgentSpec,
});

// The builtin that spawns sub-agent turns. Named here (not in core) because
// resolvers, the tool registry, and the renderer's card dispatch all key on
// it, and children must never receive it (depth is capped at 1).
export const SPAWN_AGENT_TOOL_NAME = "spawn-agent";

// The ResolvedAgent.agentId convention for inline agents; also what sessions
// denormalize into their index for inline-agent turns.
export function inlineAgentId(name: string): string {
    return `inline:${name}`;
}

export const RequestedAgent = z.union([AgentByIdRequest, InlineAgentRequest]);

export function isInlineAgentRequest(
    requested: z.infer<typeof RequestedAgent>,
): requested is z.infer<typeof InlineAgentRequest> {
    return "inline" in requested;
}

export const ToolDescriptor = z.object({
    toolId: z.string(),
    name: z.string(),
    description: z.string(),
    inputSchema: z.json(),
    execution: z.enum(["sync", "async"]),
    requiresHuman: z.boolean(),
});

export const ResolvedAgent = z.object({
    agentId: z.string(),
    systemPrompt: z.string(),
    model: ModelDescriptor,
    tools: z.array(ToolDescriptor),
});

// Session turns whose system prompt and tool set are byte-identical to the
// previous turn's materialized snapshot inherit it by reference instead of
// re-persisting ~tens of KB per turn (same mechanism as context references).
// The model stays concrete: it is tiny, the session index denormalizes it,
// and a mid-session model switch must not block inheritance. Written only
// when equality holds at creation; materialization walks inheritedFrom to
// the nearest concrete snapshot.
export const InheritedAgentSnapshot = z.object({
    agentId: z.string(),
    model: ModelDescriptor,
    inheritedFrom: z.string(),
});

export const ResolvedAgentSnapshot = z.union([
    ResolvedAgent,
    InheritedAgentSnapshot,
]);

export function isInheritedSnapshot(
    resolved: z.infer<typeof ResolvedAgentSnapshot>,
): resolved is z.infer<typeof InheritedAgentSnapshot> {
    return "inheritedFrom" in resolved;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

// Context excludes system-role messages: the resolved agent owns the single
// authoritative system prompt.
export const ConversationMessage = z.discriminatedUnion("role", [
    UserMessage,
    AssistantMessage,
    ToolMessage,
]);

// A reference points at the immediately preceding turn; its materialized
// value is that turn's transcript (context + input + produced messages).
// Inline arrays are used by standalone turns and by callers that assemble
// context themselves. Resolution is a runtime concern; the reducer treats
// context as opaque.
export const TurnContextRef = z.object({
    previousTurnId: z.string(),
});

export const TurnContext = z.union([
    TurnContextRef,
    z.array(ConversationMessage),
]);

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export const TurnUsage = z.object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Durable events
// ---------------------------------------------------------------------------

export const TurnCreated = z.object({
    type: z.literal("turn_created"),
    schemaVersion: z.literal(1),
    turnId: z.string(),
    ts: z.string(),
    sessionId: z.string().nullable(),
    agent: z.object({
        requested: RequestedAgent,
        resolved: ResolvedAgentSnapshot,
    }),
    context: TurnContext,
    input: UserMessage,
    config: z.object({
        autoPermission: z.boolean(),
        humanAvailable: z.boolean(),
        maxModelCalls: z.number().int().positive(),
        // Canonical per-turn reasoning effort; absent = auto (provider
        // default). Stamped into every model call's parameters and mapped
        // to provider-specific options at invoke time.
        reasoningEffort: ReasoningEffort.optional(),
    }),
});

// A model request is a list of REFERENCES into the turn's own events; every
// referenced byte exists exactly once in the file. The request records only
// what is NEW since the previous model call:
//   call 0:  [{context}?, {input}]      (context only when inline and nonempty;
//                                        cross-turn prefixes ride contextRef)
//   call N:  [{assistant: N-1}, ...that batch's toolResults in source order]
//   re-issue after an interrupted call: []
// The system prompt and tool set are NOT repeated here — they are byte-
// identical to turn_created.agent.resolved by construction. The exact
// provider payload is rebuilt deterministically by the request composer
// (core), which is the same code path the loop sends through.
// Compact string refs so raw JSONL reads naturally:
//   "context" | "input" | "assistant:<modelCallIndex>" | "toolResult:<toolCallId>"
export const ModelRequestMessageRef = z
    .string()
    .regex(/^(context|input|assistant:\d+|toolResult:.+)$/);

export type ParsedRequestRef =
    | { kind: "context" }
    | { kind: "input" }
    | { kind: "assistant"; modelCallIndex: number }
    | { kind: "toolResult"; toolCallId: string };

export const assistantRef = (modelCallIndex: number): string =>
    `assistant:${modelCallIndex}`;
export const toolResultRef = (toolCallId: string): string =>
    `toolResult:${toolCallId}`;

export function parseRequestRef(ref: string): ParsedRequestRef {
    if (ref === "context" || ref === "input") {
        return { kind: ref };
    }
    if (ref.startsWith("assistant:")) {
        const modelCallIndex = Number(ref.slice("assistant:".length));
        if (!Number.isInteger(modelCallIndex) || modelCallIndex < 0) {
            throw new Error(`malformed request ref: ${ref}`);
        }
        return { kind: "assistant", modelCallIndex };
    }
    if (ref.startsWith("toolResult:")) {
        return { kind: "toolResult", toolCallId: ref.slice("toolResult:".length) };
    }
    throw new Error(`malformed request ref: ${ref}`);
}

export const ModelRequest = z.object({
    contextRef: TurnContextRef.optional(),
    messages: z.array(ModelRequestMessageRef),
    parameters: z.record(z.string(), z.json()),
});

export const ModelCallRequested = z.object({
    type: z.literal("model_call_requested"),
    turnId: z.string(),
    ts: z.string(),
    modelCallIndex: z.number().int().nonnegative(),
    request: ModelRequest,
});

// Normalized provider step events kept for debugging. Raw text/reasoning
// deltas are stream-only and never appear here.
export const DurableLlmStepStreamEvent = z.discriminatedUnion("type", [
    z.object({ type: z.literal("text_start") }),
    z.object({ type: z.literal("text_end"), text: z.string() }),
    z.object({ type: z.literal("reasoning_start") }),
    z.object({ type: z.literal("reasoning_end"), text: z.string() }),
    z.object({ type: z.literal("tool_call"), toolCall: ToolCallPart }),
    z.object({
        type: z.literal("finish_step"),
        finishReason: z.string(),
        usage: TurnUsage.optional(),
        providerMetadata: z.json().optional(),
    }),
    z.object({ type: z.literal("provider_error"), error: z.string() }),
]);

export const ModelStepEvent = z.object({
    type: z.literal("model_step_event"),
    turnId: z.string(),
    ts: z.string(),
    modelCallIndex: z.number().int().nonnegative(),
    event: DurableLlmStepStreamEvent,
});

export const ModelCallCompleted = z.object({
    type: z.literal("model_call_completed"),
    turnId: z.string(),
    ts: z.string(),
    modelCallIndex: z.number().int().nonnegative(),
    message: AssistantMessage,
    finishReason: z.string(),
    usage: TurnUsage,
    providerMetadata: z.json().optional(),
});

export const ModelCallFailed = z.object({
    type: z.literal("model_call_failed"),
    turnId: z.string(),
    ts: z.string(),
    modelCallIndex: z.number().int().nonnegative(),
    error: z.string(),
});

export const ToolPermissionRequired = z.object({
    type: z.literal("tool_permission_required"),
    turnId: z.string(),
    ts: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    request: z.json(),
    checkerError: z.string().optional(),
});

export const ToolPermissionClassified = z.object({
    type: z.literal("tool_permission_classified"),
    turnId: z.string(),
    ts: z.string(),
    toolCallId: z.string(),
    decision: z.enum(["allow", "deny", "defer"]),
    reason: z.string(),
});

export const ToolPermissionClassificationFailed = z.object({
    type: z.literal("tool_permission_classification_failed"),
    turnId: z.string(),
    ts: z.string(),
    toolCallIds: z.array(z.string()),
    error: z.string(),
});

// The only effective execution decision; classifier records are provenance.
export const ToolPermissionResolved = z.object({
    type: z.literal("tool_permission_resolved"),
    turnId: z.string(),
    ts: z.string(),
    toolCallId: z.string(),
    decision: z.enum(["allow", "deny"]),
    source: z.enum(["classifier", "human", "human_unavailable"]),
    reason: z.string().optional(),
    metadata: z.json().optional(),
});

export const ToolInvocationRequested = z.object({
    type: z.literal("tool_invocation_requested"),
    turnId: z.string(),
    ts: z.string(),
    toolCallId: z.string(),
    toolId: z.string(),
    toolName: z.string(),
    execution: z.enum(["sync", "async"]),
    input: z.json(),
});

export const ToolProgress = z.object({
    type: z.literal("tool_progress"),
    turnId: z.string(),
    ts: z.string(),
    toolCallId: z.string(),
    source: z.enum(["sync", "async"]),
    progress: z.json(),
});

export const ToolResultData = z.object({
    output: z.json(),
    isError: z.boolean(),
    metadata: z.json().optional(),
});

// `runtime` results cover permission denial, unknown tools, unusable calls,
// human unavailability, cancellation, and interrupted sync execution. A
// result may exist without an invocation when execution was rejected before
// dispatch.
export const ToolResult = z.object({
    type: z.literal("tool_result"),
    turnId: z.string(),
    ts: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    source: z.enum(["sync", "async", "runtime"]),
    result: ToolResultData,
});

// A successful sync tool extended the turn's toolset mid-turn (e.g. loadSkill
// attaching a skill's declared tools). The descriptors are snapshotted in the
// event so replay needs no external lookups; they apply to every model call
// requested after this point. This is the one sanctioned exception to the
// tool-set immutability rule — explicit and durable, never silent.
export const ToolsExtended = z.object({
    type: z.literal("tools_extended"),
    turnId: z.string(),
    ts: z.string(),
    // The tool result that carried these additions (metadata.addTools).
    toolCallId: z.string(),
    // Human-readable origin, e.g. the skill id that declared the tools.
    source: z.string(),
    tools: z.array(ToolDescriptor).min(1),
});

export const TurnSuspended = z.object({
    type: z.literal("turn_suspended"),
    turnId: z.string(),
    ts: z.string(),
    pendingPermissions: z.array(
        z.object({
            toolCallId: z.string(),
            toolName: z.string(),
            request: z.json(),
        }),
    ),
    pendingAsyncTools: z.array(
        z.object({
            toolCallId: z.string(),
            toolId: z.string(),
            toolName: z.string(),
            input: z.json(),
        }),
    ),
    usage: TurnUsage,
});

export const TurnCompleted = z.object({
    type: z.literal("turn_completed"),
    turnId: z.string(),
    ts: z.string(),
    output: AssistantMessage,
    finishReason: z.string(),
    usage: TurnUsage,
});

export const TurnFailed = z.object({
    type: z.literal("turn_failed"),
    turnId: z.string(),
    ts: z.string(),
    error: z.string(),
    // Machine-readable discriminator for failures callers must tell apart;
    // MODEL_CALL_LIMIT_ERROR_CODE is defined by the spec.
    code: z.string().optional(),
    usage: TurnUsage,
});

export const TurnCancelled = z.object({
    type: z.literal("turn_cancelled"),
    turnId: z.string(),
    ts: z.string(),
    reason: z.string().optional(),
    usage: TurnUsage,
});

export const TurnEvent = z.discriminatedUnion("type", [
    TurnCreated,
    ModelCallRequested,
    ModelStepEvent,
    ModelCallCompleted,
    ModelCallFailed,
    ToolPermissionRequired,
    ToolPermissionClassified,
    ToolPermissionClassificationFailed,
    ToolPermissionResolved,
    ToolInvocationRequested,
    ToolProgress,
    ToolResult,
    ToolsExtended,
    TurnSuspended,
    TurnCompleted,
    TurnFailed,
    TurnCancelled,
]);

// ---------------------------------------------------------------------------
// Ephemeral stream-only deltas (never persisted)
// ---------------------------------------------------------------------------

export type TextDelta = {
    type: "text_delta";
    turnId: string;
    modelCallIndex: number;
    delta: string;
};

export type ReasoningDelta = {
    type: "reasoning_delta";
    turnId: string;
    modelCallIndex: number;
    delta: string;
};

export type TurnStreamEvent =
    | z.infer<typeof TurnEvent>
    | TextDelta
    | ReasoningDelta;

// One entry on the process-wide turn event bus: every event of every turn the
// runtime executes, tagged with its origin so consumers can subscribe without
// knowing who started the turn. `offset` is the 1-based line index of a
// durable event in the turn's JSONL file — a late subscriber can fetch the
// turn snapshot and discard bus events with offset <= snapshot length to join
// a live turn without gaps or duplicates. Deltas are not durable and carry no
// offset.
export interface TurnBusEvent {
    turnId: string;
    sessionId: string | null;
    event: TurnStreamEvent;
    offset?: number;
}

export function isDurableTurnEvent(
    event: TurnStreamEvent,
): event is z.infer<typeof TurnEvent> {
    return event.type !== "text_delta" && event.type !== "reasoning_delta";
}

// ---------------------------------------------------------------------------
// Derived turn state
// ---------------------------------------------------------------------------

export class TurnCorruptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TurnCorruptionError";
    }
}

export interface ModelCallState {
    index: number;
    request: z.infer<typeof ModelRequest>;
    stepEvents: Array<z.infer<typeof DurableLlmStepStreamEvent>>;
    response?: z.infer<typeof AssistantMessage>;
    finishReason?: string;
    usage?: z.infer<typeof TurnUsage>;
    providerMetadata?: JsonValue;
    error?: string;
}

export interface ToolCallState {
    modelCallIndex: number;
    order: number;
    toolCallId: string;
    toolName: string;
    input: unknown;
    toolId?: string;
    execution?: "sync" | "async";
    permission?: {
        required: z.infer<typeof ToolPermissionRequired>;
        classification?: z.infer<typeof ToolPermissionClassified>;
        // Set when a tool_permission_classification_failed event named this
        // call; such calls are treated as defer and never re-classified.
        classificationFailed?: boolean;
        resolved?: z.infer<typeof ToolPermissionResolved>;
    };
    invocation?: z.infer<typeof ToolInvocationRequested>;
    progress: Array<z.infer<typeof ToolProgress>>;
    result?: z.infer<typeof ToolResult>;
}

export interface ToolExtensionState {
    event: z.infer<typeof ToolsExtended>;
    // Extensions land between model calls; every call requested from this
    // index onward sees the added tools.
    firstAffectedModelCallIndex: number;
}

export interface TurnState {
    definition: z.infer<typeof TurnCreated>;
    modelCalls: ModelCallState[];
    toolCalls: ToolCallState[];
    toolExtensions: ToolExtensionState[];
    suspension?: z.infer<typeof TurnSuspended>;
    terminal?:
        | z.infer<typeof TurnCompleted>
        | z.infer<typeof TurnFailed>
        | z.infer<typeof TurnCancelled>;
    usage: z.infer<typeof TurnUsage>;
}

function fail(message: string): never {
    throw new TurnCorruptionError(message);
}

function isContextRef(
    context: z.infer<typeof TurnContext>,
): context is z.infer<typeof TurnContextRef> {
    return !Array.isArray(context);
}

function findToolCall(state: TurnState, toolCallId: string): ToolCallState {
    const toolCall = state.toolCalls.find(
        (tc) => tc.toolCallId === toolCallId,
    );
    if (!toolCall) {
        fail(`event targets unknown tool call: ${toolCallId}`);
    }
    return toolCall;
}

function openModelCall(state: TurnState): ModelCallState | undefined {
    const last = state.modelCalls[state.modelCalls.length - 1];
    if (last && last.response === undefined && last.error === undefined) {
        return last;
    }
    return undefined;
}

function batchToolCalls(state: TurnState, modelCallIndex: number): ToolCallState[] {
    return state.toolCalls
        .filter((tc) => tc.modelCallIndex === modelCallIndex)
        .sort((a, b) => a.order - b.order);
}

function addUsage(
    total: z.infer<typeof TurnUsage>,
    usage: z.infer<typeof TurnUsage>,
): void {
    const keys = [
        "inputTokens",
        "outputTokens",
        "totalTokens",
        "reasoningTokens",
        "cachedInputTokens",
    ] as const;
    for (const key of keys) {
        const value = usage[key];
        if (value !== undefined) {
            total[key] = (total[key] ?? 0) + value;
        }
    }
}

function applyModelCallRequested(
    state: TurnState,
    event: z.infer<typeof ModelCallRequested>,
): void {
    const expectedIndex = state.modelCalls.length;
    if (event.modelCallIndex !== expectedIndex) {
        fail(
            `model call index ${event.modelCallIndex} out of order; expected ${expectedIndex}`,
        );
    }
    if (expectedIndex >= state.definition.config.maxModelCalls) {
        fail(
            `model call index ${event.modelCallIndex} exceeds maxModelCalls ${state.definition.config.maxModelCalls}`,
        );
    }
    if (openModelCall(state)) {
        fail("concurrent unresolved model call requests");
    }
    const unresolved = state.toolCalls.filter((tc) => !tc.result);
    if (unresolved.length > 0) {
        fail(
            `model call requested while tool calls are unresolved: ${unresolved
                .map((tc) => tc.toolCallId)
                .join(", ")}`,
        );
    }

    const context = state.definition.context;
    let expectedRefs: string[];
    if (event.modelCallIndex === 0) {
        if (isContextRef(context)) {
            if (event.request.contextRef?.previousTurnId !== context.previousTurnId) {
                fail("model request contextRef inconsistent with turn context");
            }
            expectedRefs = ["input"];
        } else {
            if (event.request.contextRef !== undefined) {
                fail("model request has contextRef but turn context is inline");
            }
            expectedRefs = context.length > 0 ? ["context", "input"] : ["input"];
        }
    } else {
        if (event.request.contextRef !== undefined) {
            fail("model request has contextRef on a non-initial model call");
        }
        const previous = state.modelCalls[event.modelCallIndex - 1];
        expectedRefs =
            previous.response !== undefined
                ? [
                      assistantRef(previous.index),
                      ...batchToolCalls(state, previous.index).map((tc) =>
                          toolResultRef(tc.toolCallId),
                      ),
                  ]
                : []; // re-issue after an interrupted call adds nothing new
    }
    if (JSON.stringify(event.request.messages) !== JSON.stringify(expectedRefs)) {
        fail(
            `model request references do not match the transcript: expected ${JSON.stringify(
                expectedRefs,
            )}, got ${JSON.stringify(event.request.messages)}`,
        );
    }

    state.modelCalls.push({
        index: event.modelCallIndex,
        request: event.request,
        stepEvents: [],
    });
}

function applyModelStepEvent(
    state: TurnState,
    event: z.infer<typeof ModelStepEvent>,
): void {
    const call = state.modelCalls[event.modelCallIndex];
    if (!call) {
        fail(`step event without matching model call request: ${event.modelCallIndex}`);
    }
    if (call.response !== undefined || call.error !== undefined) {
        fail(`step event after model call ${event.modelCallIndex} settled`);
    }
    call.stepEvents.push(event.event);
}

function applyModelCallCompleted(
    state: TurnState,
    event: z.infer<typeof ModelCallCompleted>,
): void {
    const call = state.modelCalls[event.modelCallIndex];
    if (!call) {
        fail(`model call completion without matching request: ${event.modelCallIndex}`);
    }
    if (call.response !== undefined || call.error !== undefined) {
        fail(`duplicate settlement for model call ${event.modelCallIndex}`);
    }
    call.response = event.message;
    call.finishReason = event.finishReason;
    call.usage = event.usage;
    call.providerMetadata = event.providerMetadata;
    addUsage(state.usage, event.usage);

    const parts = Array.isArray(event.message.content)
        ? event.message.content
        : [];
    let order = 0;
    for (const part of parts) {
        if (part.type !== "tool-call") {
            continue;
        }
        if (state.toolCalls.some((tc) => tc.toolCallId === part.toolCallId)) {
            fail(`duplicate tool call id: ${part.toolCallId}`);
        }
        const resolved = state.definition.agent.resolved;
        // Mid-turn extensions are searched first (their descriptors are
        // always in the log); inherited base snapshots resolve outside the
        // reducer, so identity fields for those tools arrive via
        // tool_invocation_requested events instead.
        const descriptor =
            extendedToolsFor(state, event.modelCallIndex).find(
                (tool) => tool.name === part.toolName,
            ) ??
            (isInheritedSnapshot(resolved)
                ? undefined
                : resolved.tools.find((tool) => tool.name === part.toolName));
        state.toolCalls.push({
            modelCallIndex: event.modelCallIndex,
            order: order++,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.arguments,
            toolId: descriptor?.toolId,
            execution: descriptor?.execution,
            progress: [],
        });
    }
}

function applyModelCallFailed(
    state: TurnState,
    event: z.infer<typeof ModelCallFailed>,
): void {
    const call = state.modelCalls[event.modelCallIndex];
    if (!call) {
        fail(`model call failure without matching request: ${event.modelCallIndex}`);
    }
    if (call.response !== undefined || call.error !== undefined) {
        fail(`duplicate settlement for model call ${event.modelCallIndex}`);
    }
    call.error = event.error;
}

function applyToolPermissionRequired(
    state: TurnState,
    event: z.infer<typeof ToolPermissionRequired>,
): void {
    const toolCall = findToolCall(state, event.toolCallId);
    if (toolCall.result) {
        fail(`permission requirement after tool result: ${event.toolCallId}`);
    }
    if (toolCall.invocation) {
        fail(`permission requirement after invocation: ${event.toolCallId}`);
    }
    if (toolCall.permission) {
        fail(`duplicate permission requirement: ${event.toolCallId}`);
    }
    toolCall.permission = { required: event };
}

function applyToolPermissionClassified(
    state: TurnState,
    event: z.infer<typeof ToolPermissionClassified>,
): void {
    const toolCall = findToolCall(state, event.toolCallId);
    if (!toolCall.permission) {
        fail(`classification without permission requirement: ${event.toolCallId}`);
    }
    if (toolCall.permission.resolved) {
        fail(`classification after permission resolution: ${event.toolCallId}`);
    }
    if (toolCall.permission.classification) {
        fail(`duplicate permission classification: ${event.toolCallId}`);
    }
    toolCall.permission.classification = event;
}

function applyToolPermissionClassificationFailed(
    state: TurnState,
    event: z.infer<typeof ToolPermissionClassificationFailed>,
): void {
    for (const toolCallId of event.toolCallIds) {
        const toolCall = findToolCall(state, toolCallId);
        if (!toolCall.permission) {
            fail(`classification failure without permission requirement: ${toolCallId}`);
        }
        if (toolCall.permission.resolved) {
            fail(`classification failure after permission resolution: ${toolCallId}`);
        }
        toolCall.permission.classificationFailed = true;
    }
}

function applyToolPermissionResolved(
    state: TurnState,
    event: z.infer<typeof ToolPermissionResolved>,
): void {
    const toolCall = findToolCall(state, event.toolCallId);
    if (!toolCall.permission) {
        fail(`permission resolution without requirement: ${event.toolCallId}`);
    }
    if (toolCall.permission.resolved) {
        fail(`conflicting permission decisions: ${event.toolCallId}`);
    }
    if (toolCall.result) {
        fail(`permission resolution after tool result: ${event.toolCallId}`);
    }
    toolCall.permission.resolved = event;
}

function applyToolInvocationRequested(
    state: TurnState,
    event: z.infer<typeof ToolInvocationRequested>,
): void {
    const toolCall = findToolCall(state, event.toolCallId);
    if (toolCall.invocation) {
        fail(`duplicate tool invocation: ${event.toolCallId}`);
    }
    if (toolCall.result) {
        fail(`tool invocation after result: ${event.toolCallId}`);
    }
    if (toolCall.toolName !== event.toolName) {
        fail(`tool invocation name mismatch: ${event.toolCallId}`);
    }
    if (toolCall.permission && toolCall.permission.resolved?.decision !== "allow") {
        fail(`tool invocation without permission allowance: ${event.toolCallId}`);
    }
    if (toolCall.execution !== undefined && toolCall.execution !== event.execution) {
        fail(`tool invocation execution mismatch: ${event.toolCallId}`);
    }
    if (toolCall.toolId !== undefined && toolCall.toolId !== event.toolId) {
        fail(`tool invocation toolId mismatch: ${event.toolCallId}`);
    }
    toolCall.execution = event.execution;
    toolCall.toolId = event.toolId;
    toolCall.invocation = event;
}

function applyToolProgress(
    state: TurnState,
    event: z.infer<typeof ToolProgress>,
): void {
    const toolCall = findToolCall(state, event.toolCallId);
    if (!toolCall.invocation) {
        fail(`tool progress without invocation: ${event.toolCallId}`);
    }
    if (toolCall.result) {
        fail(`tool progress after terminal result: ${event.toolCallId}`);
    }
    if (event.source !== toolCall.execution) {
        fail(`tool progress source mismatch: ${event.toolCallId}`);
    }
    toolCall.progress.push(event);
}

function applyToolResult(
    state: TurnState,
    event: z.infer<typeof ToolResult>,
): void {
    const toolCall = findToolCall(state, event.toolCallId);
    if (toolCall.result) {
        fail(`duplicate tool result: ${event.toolCallId}`);
    }
    if (toolCall.toolName !== event.toolName) {
        fail(`tool result name mismatch: ${event.toolCallId}`);
    }
    if (event.source !== "runtime") {
        if (!toolCall.invocation) {
            fail(`${event.source} tool result without invocation: ${event.toolCallId}`);
        }
        if (event.source !== toolCall.execution) {
            fail(`tool result source mismatch: ${event.toolCallId}`);
        }
    }
    toolCall.result = event;
}

function applyToolsExtended(
    state: TurnState,
    event: z.infer<typeof ToolsExtended>,
): void {
    if (openModelCall(state)) {
        fail("tools extended while a model call is unsettled");
    }
    const toolCall = findToolCall(state, event.toolCallId);
    if (!toolCall.result) {
        fail(`tools extended without a tool result: ${event.toolCallId}`);
    }
    if (toolCall.result.result.isError) {
        fail(`tools extended by a failed tool call: ${event.toolCallId}`);
    }
    // Collision check covers prior extensions and (when visible) the base
    // snapshot; inherited snapshots are opaque to the reducer, so their base
    // names are enforced by the runtime's dedupe instead.
    const existing = new Set(
        extendedToolsFor(state, state.modelCalls.length).map((t) => t.name),
    );
    const resolved = state.definition.agent.resolved;
    if (!isInheritedSnapshot(resolved)) {
        for (const tool of resolved.tools) {
            existing.add(tool.name);
        }
    }
    for (const tool of event.tools) {
        if (existing.has(tool.name)) {
            fail(`tools extended with a colliding tool name: ${tool.name}`);
        }
        existing.add(tool.name);
    }
    state.toolExtensions.push({
        event,
        firstAffectedModelCallIndex: state.modelCalls.length,
    });
}

function sortedIds(ids: string[]): string {
    return [...ids].sort().join(",");
}

function applyTurnSuspended(
    state: TurnState,
    event: z.infer<typeof TurnSuspended>,
): void {
    if (openModelCall(state)) {
        fail("suspension while a model call is unsettled");
    }
    const expectedPermissions = outstandingPermissions(state).map(
        (tc) => tc.toolCallId,
    );
    const expectedAsync = outstandingAsyncTools(state).map((tc) => tc.toolCallId);
    if (expectedPermissions.length + expectedAsync.length === 0) {
        fail("suspension without pending external work");
    }
    const claimedPermissions = event.pendingPermissions.map((p) => p.toolCallId);
    const claimedAsync = event.pendingAsyncTools.map((p) => p.toolCallId);
    if (
        sortedIds(claimedPermissions) !== sortedIds(expectedPermissions) ||
        sortedIds(claimedAsync) !== sortedIds(expectedAsync)
    ) {
        fail("suspension snapshot inconsistent with pending state");
    }
    state.suspension = event;
}

function assertTerminalPreconditions(state: TurnState, kind: string): void {
    if (openModelCall(state)) {
        fail(`${kind} while a model call is unsettled`);
    }
    const unresolved = state.toolCalls.filter((tc) => !tc.result);
    if (unresolved.length > 0) {
        fail(
            `${kind} while tool calls lack terminal results: ${unresolved
                .map((tc) => tc.toolCallId)
                .join(", ")}`,
        );
    }
}

function applyTurnCompleted(
    state: TurnState,
    event: z.infer<typeof TurnCompleted>,
): void {
    assertTerminalPreconditions(state, "completion");
    const last = state.modelCalls[state.modelCalls.length - 1];
    if (!last || last.response === undefined) {
        fail("completion without a completed model response");
    }
    if (batchToolCalls(state, last.index).length > 0) {
        fail("completion while the final response has tool calls");
    }
    state.terminal = event;
}

export function reduceTurn(
    events: Array<z.infer<typeof TurnEvent>>,
): TurnState {
    if (events.length === 0) {
        fail("turn log is empty");
    }
    const [first, ...rest] = events;
    if (first.type !== "turn_created") {
        fail(`first event must be turn_created, got ${first.type}`);
    }
    if (first.schemaVersion !== 1) {
        fail(`unsupported turn schema version: ${String(first.schemaVersion)}`);
    }

    if (isInheritedSnapshot(first.agent.resolved)) {
        const context = first.context;
        if (
            Array.isArray(context) ||
            context.previousTurnId !== first.agent.resolved.inheritedFrom
        ) {
            fail(
                "inherited agent snapshot must reference the turn's context predecessor",
            );
        }
    }

    const state: TurnState = {
        definition: first,
        modelCalls: [],
        toolCalls: [],
        toolExtensions: [],
        usage: {},
    };

    for (const event of rest) {
        if (event.turnId !== first.turnId) {
            fail(
                `event turnId ${event.turnId} does not match turn ${first.turnId}`,
            );
        }
        if (state.terminal) {
            fail(`event after terminal turn event: ${event.type}`);
        }
        switch (event.type) {
            case "turn_created":
                fail("duplicate turn_created event");
                break;
            case "model_call_requested":
                applyModelCallRequested(state, event);
                break;
            case "model_step_event":
                applyModelStepEvent(state, event);
                break;
            case "model_call_completed":
                applyModelCallCompleted(state, event);
                break;
            case "model_call_failed":
                applyModelCallFailed(state, event);
                break;
            case "tool_permission_required":
                applyToolPermissionRequired(state, event);
                break;
            case "tool_permission_classified":
                applyToolPermissionClassified(state, event);
                break;
            case "tool_permission_classification_failed":
                applyToolPermissionClassificationFailed(state, event);
                break;
            case "tool_permission_resolved":
                applyToolPermissionResolved(state, event);
                break;
            case "tool_invocation_requested":
                applyToolInvocationRequested(state, event);
                break;
            case "tool_progress":
                applyToolProgress(state, event);
                break;
            case "tool_result":
                applyToolResult(state, event);
                break;
            case "tools_extended":
                applyToolsExtended(state, event);
                break;
            case "turn_suspended":
                applyTurnSuspended(state, event);
                break;
            case "turn_completed":
                applyTurnCompleted(state, event);
                break;
            case "turn_failed":
                assertTerminalPreconditions(state, "failure");
                state.terminal = event;
                break;
            case "turn_cancelled":
                assertTerminalPreconditions(state, "cancellation");
                state.terminal = event;
                break;
            default: {
                const unknown: never = event;
                fail(`unknown turn event type: ${(unknown as { type: string }).type}`);
            }
        }
    }

    return state;
}

// ---------------------------------------------------------------------------
// Pure derivations over TurnState
// ---------------------------------------------------------------------------

// Descriptors added by durable extensions in effect for a given model call.
export function extendedToolsFor(
    state: TurnState,
    modelCallIndex: number,
): Array<z.infer<typeof ToolDescriptor>> {
    return state.toolExtensions
        .filter((ext) => ext.firstAffectedModelCallIndex <= modelCallIndex)
        .flatMap((ext) => ext.event.tools);
}

// The full toolset a given model call sees: the agent snapshot's base tools
// plus every extension recorded before that call was requested. The base set
// comes from the materialized agent (inherited snapshots are opaque here),
// so callers pass it in.
export function effectiveTools(
    state: TurnState,
    modelCallIndex: number,
    baseTools: Array<z.infer<typeof ToolDescriptor>>,
): Array<z.infer<typeof ToolDescriptor>> {
    const extended = extendedToolsFor(state, modelCallIndex);
    return extended.length === 0 ? baseTools : [...baseTools, ...extended];
}

export function outstandingPermissions(state: TurnState): ToolCallState[] {
    return state.toolCalls.filter(
        (tc) => tc.permission && !tc.permission.resolved && !tc.result,
    );
}

export function outstandingAsyncTools(state: TurnState): ToolCallState[] {
    return state.toolCalls.filter(
        (tc) => tc.invocation && tc.execution === "async" && !tc.result,
    );
}

export type TurnStatus =
    | "completed"
    | "failed"
    | "cancelled"
    | "suspended"
    | "idle";

// No durable running status exists by design: an "idle" turn is simply
// non-terminal with no outstanding external work. Whether it is actively
// being advanced right now is ephemeral bus state.
export function deriveTurnStatus(state: TurnState): TurnStatus {
    if (state.terminal) {
        switch (state.terminal.type) {
            case "turn_completed":
                return "completed";
            case "turn_failed":
                return "failed";
            case "turn_cancelled":
                return "cancelled";
        }
    }
    if (
        outstandingPermissions(state).length > 0 ||
        outstandingAsyncTools(state).length > 0
    ) {
        return "suspended";
    }
    return "idle";
}

function toolResultContent(result: z.infer<typeof ToolResult>): string {
    const output = result.result.output;
    return typeof output === "string" ? output : JSON.stringify(output);
}

// The canonical model-facing tool message for a resolved tool call.
export function toolResultMessage(
    toolCall: ToolCallState,
): z.infer<typeof ConversationMessage> {
    if (!toolCall.result) {
        throw new Error(
            `tool call ${toolCall.toolCallId} has no terminal result`,
        );
    }
    return {
        role: "tool",
        content: toolResultContent(toolCall.result),
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
    };
}

// Resolves one model call's request references to structural messages (the
// NEW portion that call added relative to the previous one). Concatenating
// calls 0..N yields the full current-turn conversation for call N; the
// request composer (core) prepends the resolved cross-turn prefix and
// encodes to the provider wire form.
export function requestMessagesFor(
    state: TurnState,
    modelCallIndex: number,
): Array<z.infer<typeof ConversationMessage>> {
    const call = state.modelCalls[modelCallIndex];
    if (!call) {
        throw new Error(`no model call at index ${modelCallIndex}`);
    }
    return call.request.messages.flatMap((raw) => {
        const ref = parseRequestRef(raw);
        switch (ref.kind) {
            case "context": {
                const context = state.definition.context;
                if (!Array.isArray(context)) {
                    throw new Error("context ref on a turn without inline context");
                }
                return context;
            }
            case "input":
                return [state.definition.input];
            case "assistant": {
                const response = state.modelCalls[ref.modelCallIndex]?.response;
                if (response === undefined) {
                    throw new Error(
                        `assistant ref to unsettled model call ${ref.modelCallIndex}`,
                    );
                }
                return [response];
            }
            case "toolResult": {
                const toolCall = state.toolCalls.find(
                    (tc) => tc.toolCallId === ref.toolCallId,
                );
                if (!toolCall) {
                    throw new Error(`toolResult ref to unknown call ${ref.toolCallId}`);
                }
                return [toolResultMessage(toolCall)];
            }
        }
    });
}

// The messages this turn contributed to the conversation: its input plus, per
// completed model call, the assistant response and its tool results in source
// order. Failed model calls contribute nothing. The turn's context prefix is
// NOT included; materializing the full conversation is the context resolver's
// job (core). Requires every tool call to have a terminal result, which holds
// for all terminal turns.
export function turnTranscript(
    state: TurnState,
): Array<z.infer<typeof ConversationMessage>> {
    const messages: Array<z.infer<typeof ConversationMessage>> = [
        state.definition.input,
    ];
    for (const call of state.modelCalls) {
        if (call.response === undefined) {
            continue;
        }
        messages.push(call.response);
        for (const toolCall of batchToolCalls(state, call.index)) {
            if (!toolCall.result) {
                throw new Error(
                    `turnTranscript requires terminal tool results; ${toolCall.toolCallId} is unresolved`,
                );
            }
            messages.push(toolResultMessage(toolCall));
        }
    }
    return messages;
}
