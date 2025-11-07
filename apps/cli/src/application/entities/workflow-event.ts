import { z } from "zod";
import { LlmStepStreamEvent } from "./llm-step-event.js";
import { Workflow } from "./workflow.js";
import { Message } from "./message.js";

export const WorkflowStreamStartEvent = z.object({
    type: z.literal("workflow-start"),
    workflowId: z.string(),
    workflow: Workflow,
    background: z.boolean(),
});

export const WorkflowStreamStepStartEvent = z.object({
    type: z.literal("workflow-step-start"),
    stepId: z.string(),
    stepType: z.enum(["agent", "function"]),
});

export const WorkflowStreamStepStreamEventEvent = z.object({
    type: z.literal("workflow-step-stream-event"),
    stepId: z.string(),
    event: LlmStepStreamEvent,
});

export const WorkflowStreamStepMessageEvent = z.object({
    type: z.literal("workflow-step-message"),
    stepId: z.string(),
    message: Message,
});

export const WorkflowStreamStepToolInvocationEvent = z.object({
    type: z.literal("workflow-step-tool-invocation"),
    stepId: z.string(),
    toolName: z.string(),
    input: z.string(),
});

export const WorkflowStreamStepToolResultEvent = z.object({
    type: z.literal("workflow-step-tool-result"),
    stepId: z.string(),
    toolName: z.string(),
    result: z.any(),
});

export const WorkflowStreamStepEndEvent = z.object({
    type: z.literal("workflow-step-end"),
    stepId: z.string(),
});

export const WorkflowStreamEndEvent = z.object({
    type: z.literal("workflow-end"),
});

export const WorkflowStreamErrorEvent = z.object({
    type: z.literal("workflow-error"),
    error: z.string(),
});

export const WorkflowStreamEvent = z.union([
    WorkflowStreamStartEvent,
    WorkflowStreamStepStartEvent,
    WorkflowStreamStepStreamEventEvent,
    WorkflowStreamStepMessageEvent,
    WorkflowStreamStepToolInvocationEvent,
    WorkflowStreamStepToolResultEvent,
    WorkflowStreamStepEndEvent,
    WorkflowStreamEndEvent,
    WorkflowStreamErrorEvent,
]);