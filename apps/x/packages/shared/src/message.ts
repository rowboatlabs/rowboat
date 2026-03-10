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

// A piece of user-typed text within a content array
export const UserTextPart = z.object({
    type: z.literal("text"),
    text: z.string(),
});

// An attachment within a content array
export const UserAttachmentPart = z.object({
    type: z.literal("attachment"),
    path: z.string(),                    // absolute file path
    filename: z.string(),                // display name ("photo.png")
    mimeType: z.string(),                // MIME type ("image/png", "text/plain")
    size: z.number().optional(),         // bytes
});

// Any single part of a user message (text or attachment)
export const UserContentPart = z.union([UserTextPart, UserAttachmentPart]);

// Named type for user message content — used everywhere instead of repeating the union
export const UserMessageContent = z.union([z.string(), z.array(UserContentPart)]);

export const UserMessage = z.object({
    role: z.literal("user"),
    content: UserMessageContent,
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