import { z } from "zod";
import { Workflow } from "./workflow_types";
import { Message } from "./types";
import { DataSource } from "./datasource_types";

export const CopilotUserMessage = z.object({
    role: z.literal('user'),
    content: z.string(),
});
export const CopilotAssistantMessageTextPart = z.object({
    type: z.literal("text"),
    content: z.string(),
});
export const CopilotAssistantMessageActionPart = z.object({
    type: z.literal("action"),
    content: z.object({
        config_type: z.union([z.literal('tool'), z.literal('agent'), z.literal('prompt'), z.literal('pipeline')]),
        action: z.union([z.literal('create_new'), z.literal('edit')]),
        name: z.string(),
        change_description: z.string(),
        config_changes: z.record(z.string(), z.unknown()),
        error: z.string().optional(),
    })
});
export const CopilotAssistantMessage = z.object({
    role: z.literal('assistant'),
    content: z.string(),
});
export const CopilotMessage = z.union([CopilotUserMessage, CopilotAssistantMessage]);

export const CopilotChatContext = z.union([
    z.object({
        type: z.literal('chat'),
        messages: z.array(Message),
    }),
    z.object({
        type: z.literal('agent'),
        name: z.string(),
    }),
    z.object({
        type: z.literal('tool'),
        name: z.string(),
    }),
    z.object({
        type: z.literal('prompt'),
        name: z.string(),
    }),
]);

export const CopilotAPIRequest = z.object({
    projectId: z.string(),
    messages: z.array(CopilotMessage),
    workflow: Workflow,
    context: CopilotChatContext.nullable(),
    dataSources: z.array(DataSource.extend({
        _id: z.string(),
    })).optional(),
});
export const CopilotAPIResponse = z.union([
    z.object({
        response: z.string(),
    }),
    z.object({
        error: z.string(),
    }),
]);