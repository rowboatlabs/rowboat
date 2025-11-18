import { LlmStepStreamEvent } from "./llm-step-events.js";
import { Message, ToolCallPart } from "./message.js";
import { Agent } from "./agent.js";
import z from "zod";

const BaseRunEvent = z.object({
    ts: z.iso.datetime().optional(),
    subflow: z.array(z.string()),
});

export const StartEvent = BaseRunEvent.extend({
    type: z.literal("start"),
    runId: z.string(),
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
    message: Message,
});

export const ToolInvocationEvent = BaseRunEvent.extend({
    type: z.literal("tool-invocation"),
    toolName: z.string(),
    input: z.string(),
});

export const ToolResultEvent = BaseRunEvent.extend({
    type: z.literal("tool-result"),
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
});

export const RunErrorEvent = BaseRunEvent.extend({
    type: z.literal("error"),
    error: z.string(),
});

export const RunEvent = z.union([
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
]);