import { z } from "zod";
import { LlmStepStreamEvent } from "./llm-step-events.js";
import { Message } from "./message.js";
import { Agent } from "./agent.js";

const BaseRunEvent = z.object({
    ts: z.iso.datetime().optional(),
});

export const RunStartEvent = BaseRunEvent.extend({
    type: z.literal("start"),
    runId: z.string(),
    agentId: z.string(),
    agent: Agent,
    interactive: z.boolean(),
});

export const RunStepStartEvent = BaseRunEvent.extend({
    type: z.literal("step-start"),
});

export const RunStreamEvent = BaseRunEvent.extend({
    type: z.literal("stream-event"),
    event: LlmStepStreamEvent,
});

export const RunMessageEvent = BaseRunEvent.extend({
    type: z.literal("message"),
    message: Message,
});

export const RunToolInvocationEvent = BaseRunEvent.extend({
    type: z.literal("tool-invocation"),
    toolName: z.string(),
    input: z.string(),
});

export const RunToolResultEvent = BaseRunEvent.extend({
    type: z.literal("tool-result"),
    toolName: z.string(),
    result: z.any(),
});

export const RunStepEndEvent = BaseRunEvent.extend({
    type: z.literal("step-end"),
});

export const RunEndEvent = BaseRunEvent.extend({
    type: z.literal("end"),
});

export const RunPauseEvent = BaseRunEvent.extend({
    type: z.literal("pause-for-human-input"),
    toolCallId: z.string(),
});

export const RunResumeEvent = BaseRunEvent.extend({
    type: z.literal("resume"),
});

export const RunErrorEvent = BaseRunEvent.extend({
    type: z.literal("error"),
    error: z.string(),
});

export const RunEvent = z.union([
    RunStartEvent,
    RunStepStartEvent,
    RunStreamEvent,
    RunMessageEvent,
    RunToolInvocationEvent,
    RunToolResultEvent,
    RunStepEndEvent,
    RunEndEvent,
    RunPauseEvent,
    RunResumeEvent,
    RunErrorEvent,
]);