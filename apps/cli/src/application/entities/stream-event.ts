import { z } from "zod";

export const ReasoningStartEvent = z.object({
    type: z.literal("reasoning-start"),
});

export const ReasoningDeltaEvent = z.object({
    type: z.literal("reasoning-delta"),
    delta: z.string(),
});

export const ReasoningEndEvent = z.object({
    type: z.literal("reasoning-end"),
});

export const TextStartEvent = z.object({
    type: z.literal("text-start"),
});

export const TextDeltaEvent = z.object({
    type: z.literal("text-delta"),
    delta: z.string(),
});

export const TextEndEvent = z.object({
    type: z.literal("text-end"),
});

export const ToolCallEvent = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.any(),
});

export const UsageEvent = z.object({
    type: z.literal("usage"),
    usage: z.object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        totalTokens: z.number().optional(),
        reasoningTokens: z.number().optional(),
        cachedInputTokens: z.number().optional(),
    }),
});

export const StreamEvent = z.union([
    ReasoningStartEvent,
    ReasoningDeltaEvent,
    ReasoningEndEvent,
    TextStartEvent,
    TextDeltaEvent,
    TextEndEvent,
    ToolCallEvent,
    UsageEvent,
]);