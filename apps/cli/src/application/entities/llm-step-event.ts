import { z } from "zod";

export const LlmStepStreamReasoningStartEvent = z.object({
    type: z.literal("reasoning-start"),
});

export const LlmStepStreamReasoningDeltaEvent = z.object({
    type: z.literal("reasoning-delta"),
    delta: z.string(),
});

export const LlmStepStreamReasoningEndEvent = z.object({
    type: z.literal("reasoning-end"),
});

export const LlmStepStreamTextStartEvent = z.object({
    type: z.literal("text-start"),
});

export const LlmStepStreamTextDeltaEvent = z.object({
    type: z.literal("text-delta"),
    delta: z.string(),
});

export const LlmStepStreamTextEndEvent = z.object({
    type: z.literal("text-end"),
});

export const LlmStepStreamToolCallEvent = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.any(),
});

export const LlmStepStreamUsageEvent = z.object({
    type: z.literal("usage"),
    usage: z.object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        totalTokens: z.number().optional(),
        reasoningTokens: z.number().optional(),
        cachedInputTokens: z.number().optional(),
    }),
});

export const LlmStepStreamEvent = z.union([
    LlmStepStreamReasoningStartEvent,
    LlmStepStreamReasoningDeltaEvent,
    LlmStepStreamReasoningEndEvent,
    LlmStepStreamTextStartEvent,
    LlmStepStreamTextDeltaEvent,
    LlmStepStreamTextEndEvent,
    LlmStepStreamToolCallEvent,
    LlmStepStreamUsageEvent,
]);