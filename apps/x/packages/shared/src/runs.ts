import { LlmStepStreamEvent } from "./llm-step-events.js";
import { Message, ToolCallPart } from "./message.js";
import z from "zod";

const BaseRunEvent = z.object({
    runId: z.string(),
    ts: z.iso.datetime().optional(),
    subflow: z.array(z.string()),
});

export const RunProcessingStartEvent = BaseRunEvent.extend({
    type: z.literal("run-processing-start"),
});

export const RunProcessingEndEvent = BaseRunEvent.extend({
    type: z.literal("run-processing-end"),
});

export const StartEvent = BaseRunEvent.extend({
    type: z.literal("start"),
    agentName: z.string(),
    model: z.string(),
    provider: z.string(),
    // useCase/subUseCase tag the run for analytics. Optional on read so legacy
    // run files written before these fields existed still parse cleanly.
    useCase: z.enum([
        "copilot_chat",
        "live_note_agent",
        "meeting_note",
        "knowledge_sync",
    ]).optional(),
    subUseCase: z.string().optional(),
});

export const SpawnSubFlowEvent = BaseRunEvent.extend({
    type: z.literal("spawn-subflow"),
    agentName: z.string(),
    toolCallId: z.string(),
});

export const LlmStreamEvent = BaseRunEvent.extend({
    type: z.literal("llm-stream-event"),
    event: LlmStepStreamEvent,
});

export const MessageEvent = BaseRunEvent.extend({
    type: z.literal("message"),
    messageId: z.string(),
    message: Message,
});

const MONOTONIC_ID_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})Z(?:-|$)/;

export function monotonicIdToIsoTimestamp(id: string): string | undefined {
    const match = MONOTONIC_ID_TIMESTAMP_RE.exec(id);
    if (!match) return undefined;
    return `${match[1]}:${match[2]}:${match[3]}Z`;
}

export const ToolInvocationEvent = BaseRunEvent.extend({
    type: z.literal("tool-invocation"),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    input: z.string(),
});

export const ToolResultEvent = BaseRunEvent.extend({
    type: z.literal("tool-result"),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    result: z.any(),
});

export const ToolOutputStreamEvent = BaseRunEvent.extend({
    type: z.literal("tool-output-stream"),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.string(),
});

export const AskHumanRequestEvent = BaseRunEvent.extend({
    type: z.literal("ask-human-request"),
    toolCallId: z.string(),
    query: z.string(),
});

export const AskHumanResponseEvent = BaseRunEvent.extend({
    type: z.literal("ask-human-response"),
    toolCallId: z.string(),
    response: z.string(),
});

export const ToolPermissionRequestEvent = BaseRunEvent.extend({
    type: z.literal("tool-permission-request"),
    toolCall: ToolCallPart,
});

export const ToolPermissionResponseEvent = BaseRunEvent.extend({
    type: z.literal("tool-permission-response"),
    toolCallId: z.string(),
    response: z.enum(["approve", "deny"]),
    scope: z.enum(["once", "session", "always"]).optional(),
});

export const RunErrorEvent = BaseRunEvent.extend({
    type: z.literal("error"),
    error: z.string(),
});

export const RunStoppedEvent = BaseRunEvent.extend({
    type: z.literal("run-stopped"),
    reason: z.enum(["user-requested", "force-stopped"]).optional(),
});

export const RunEvent = z.union([
    RunProcessingStartEvent,
    RunProcessingEndEvent,
    StartEvent,
    SpawnSubFlowEvent,
    LlmStreamEvent,
    MessageEvent,
    ToolInvocationEvent,
    ToolResultEvent,
    ToolOutputStreamEvent,
    AskHumanRequestEvent,
    AskHumanResponseEvent,
    ToolPermissionRequestEvent,
    ToolPermissionResponseEvent,
    RunErrorEvent,
    RunStoppedEvent,
]);

export const ToolPermissionAuthorizePayload = ToolPermissionResponseEvent.pick({
    subflow: true,
    toolCallId: true,
    response: true,
    scope: true,
});

export const AskHumanResponsePayload = AskHumanResponseEvent.pick({
    subflow: true,
    toolCallId: true,
    response: true,
});

export const UseCase = z.enum([
    "copilot_chat",
    "live_note_agent",
    "meeting_note",
    "knowledge_sync",
]);

export const Run = z.object({
    id: z.string(),
    title: z.string().optional(),
    createdAt: z.iso.datetime(),
    lastMessageAt: z.iso.datetime().optional(),
    agentId: z.string(),
    model: z.string(),
    provider: z.string(),
    useCase: UseCase.optional(),
    subUseCase: z.string().optional(),
    log: z.array(RunEvent),
});

export const ListRunsResponse = z.object({
    runs: z.array(Run.pick({
        id: true,
        title: true,
        createdAt: true,
        lastMessageAt: true,
        agentId: true,
    })),
    nextCursor: z.string().optional(),
});

export const CreateRunOptions = z.object({
    agentId: z.string(),
    model: z.string().optional(),
    provider: z.string().optional(),
    useCase: UseCase.optional(),
    subUseCase: z.string().optional(),
});
