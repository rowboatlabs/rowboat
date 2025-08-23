import { z } from "zod";
import { Workflow } from "@/app/lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { DataSource } from "@/src/entities/models/data-source";

export const DataSourceSchemaForCopilot = DataSource.pick({
    id: true,
    name: true,
    description: true,
    data: true,
});

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
        config_type: z.enum(['tool', 'agent', 'prompt', 'pipeline', 'start_agent']),
        action: z.enum(['create_new', 'edit', 'delete']),
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
    dataSources: z.array(DataSourceSchemaForCopilot).optional(),
});
export const CopilotAPIResponse = z.union([
    z.object({
        response: z.string(),
    }),
    z.object({
        error: z.string(),
    }),
]);