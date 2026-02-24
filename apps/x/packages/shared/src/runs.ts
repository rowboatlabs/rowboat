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

export const Run = z.object({
    id: z.string(),
    title: z.string().optional(),
    createdAt: z.iso.datetime(),
    agentId: z.string(),
    log: z.array(RunEvent),
});

export const ListRunsResponse = z.object({
    runs: z.array(Run.pick({
        id: true,
        title: true,
        createdAt: true,
        agentId: true,
    })),
    nextCursor: z.string().optional(),
});

export const CreateRunOptions = Run.pick({
    agentId: true,
});