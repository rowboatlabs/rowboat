import { z } from "zod";
import { LlmStepStreamEvent } from "./llm-step-event.js";
import { Workflow } from "./workflow.js";
import { Message } from "./message.js";

const BaseRunEvent = z.object({
    ts: z.iso.datetime().optional(),
});

export const RunStartEvent = BaseRunEvent.extend({
    type: z.literal("start"),
    runId: z.string(),
    workflowId: z.string(),
    workflow: Workflow,
    interactive: z.boolean(),
});

export const RunStepStartEvent = BaseRunEvent.extend({
    type: z.literal("step-start"),
    stepIndex: z.number(),
    stepId: z.string(),
    stepType: z.enum(["agent", "function"]),
});

export const RunStreamEvent = BaseRunEvent.extend({
    type: z.literal("stream-event"),
    stepId: z.string(),
    event: LlmStepStreamEvent,
});

export const RunMessageEvent = BaseRunEvent.extend({
    type: z.literal("message"),
    stepId: z.string(),
    message: Message,
});

export const RunToolInvocationEvent = BaseRunEvent.extend({
    type: z.literal("tool-invocation"),
    stepId: z.string(),
    toolName: z.string(),
    input: z.string(),
});

export const RunToolResultEvent = BaseRunEvent.extend({
    type: z.literal("tool-result"),
    stepId: z.string(),
    toolName: z.string(),
    result: z.any(),
});

export const RunStepEndEvent = BaseRunEvent.extend({
    type: z.literal("step-end"),
    stepIndex: z.number(),
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