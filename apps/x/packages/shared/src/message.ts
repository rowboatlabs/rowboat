import { z } from "zod";

export const ProviderOptions = z.record(z.string(), z.record(z.string(), z.json()));

export const TextPart = z.object({
    type: z.literal("text"),
    text: z.string(),
    providerOptions: ProviderOptions.optional(),
});

export const ReasoningPart = z.object({
    type: z.literal("reasoning"),
    text: z.string(),
    providerOptions: ProviderOptions.optional(),
});

export const ToolCallPart = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    arguments: z.any(),
    providerOptions: ProviderOptions.optional(),
});

export const AssistantContentPart = z.union([
    TextPart,
    ReasoningPart,
    ToolCallPart,
]);

export const UserMessage = z.object({
    role: z.literal("user"),
    content: z.string(),
    providerOptions: ProviderOptions.optional(),
});

export const AssistantMessage = z.object({
    role: z.literal("assistant"),
    content: z.union([
        z.string(),
        z.array(AssistantContentPart),
    ]),
    providerOptions: ProviderOptions.optional(),
});

export const SystemMessage = z.object({
    role: z.literal("system"),
    content: z.string(),
    providerOptions: ProviderOptions.optional(),
});

export const ToolMessage = z.object({
    role: z.literal("tool"),
    content: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    providerOptions: ProviderOptions.optional(),
});

export const Message = z.discriminatedUnion("role", [
    AssistantMessage,
    SystemMessage,
    ToolMessage,
    UserMessage,
]);

export const MessageList = z.array(Message);