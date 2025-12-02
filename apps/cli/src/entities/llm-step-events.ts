import { z } from "zod";
import { ProviderOptions } from "./message.js";

const BaseEvent = z.object({
    providerOptions: ProviderOptions.optional(),
})

export const LlmStepStreamReasoningStartEvent = BaseEvent.extend({
    type: z.literal("reasoning-start"),
});

export const LlmStepStreamReasoningDeltaEvent = BaseEvent.extend({
    type: z.literal("reasoning-delta"),
    delta: z.string(),
});

export const LlmStepStreamReasoningEndEvent = BaseEvent.extend({
    type: z.literal("reasoning-end"),
});

export const LlmStepStreamTextStartEvent = BaseEvent.extend({
    type: z.literal("text-start"),
});

export const LlmStepStreamTextDeltaEvent = BaseEvent.extend({
    type: z.literal("text-delta"),
    delta: z.string(),
});

export const LlmStepStreamTextEndEvent = BaseEvent.extend({
    type: z.literal("text-end"),
});

export const LlmStepStreamToolCallEvent = BaseEvent.extend({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.any(),
});

export const LlmStepStreamFinishStepEvent = z.object({
    type: z.literal("finish-step"),
    finishReason: z.enum(["stop", "tool-calls", "length", "content-filter", "error", "other", "unknown"]),
    usage: z.object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        totalTokens: z.number().optional(),
        reasoningTokens: z.number().optional(),
        cachedInputTokens: z.number().optional(),
    }),
    providerOptions: ProviderOptions.optional(),
});

export const LlmStepStreamEvent = z.union([
    LlmStepStreamReasoningStartEvent,
    LlmStepStreamReasoningDeltaEvent,
    LlmStepStreamReasoningEndEvent,
    LlmStepStreamTextStartEvent,
    LlmStepStreamTextDeltaEvent,
    LlmStepStreamTextEndEvent,
    LlmStepStreamToolCallEvent,
    LlmStepStreamFinishStepEvent,
]);