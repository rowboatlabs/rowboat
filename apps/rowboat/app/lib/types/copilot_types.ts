import { z } from "zod";
import { Workflow } from "./workflow_types";
import { apiV1 } from "rowboat-shared"
import { AgenticAPIChatMessage } from "./agents_api_types";
import { convertToAgenticAPIChatMessages } from "./agents_api_types";
import { DataSource } from "./datasource_types";

// Create a filtered version of DataSource for copilot
export const CopilotDataSource = z.object({
    _id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    active: z.boolean().default(true),
    status: z.union([
        z.literal('pending'),
        z.literal('ready'),
        z.literal('error'),
        z.literal('deleted'),
    ]),
    error: z.string().optional(),
    data: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('urls'),
        }),
        z.object({
            type: z.literal('files_local'),
        }),
        z.object({
            type: z.literal('files_s3'),
        }),
        z.object({
            type: z.literal('text'),
        })
    ]),
}).passthrough();

export const CopilotWorkflow = Workflow.omit({
    lastUpdatedAt: true,
    projectId: true,
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
        config_type: z.union([z.literal('tool'), z.literal('agent'), z.literal('prompt')]),
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

export const CopilotApiMessage = z.object({
    role: z.union([z.literal('assistant'), z.literal('user')]),
    content: z.string(),
});
export const CopilotChatContext = z.union([
    z.object({
        type: z.literal('chat'),
        messages: z.array(apiV1.ChatMessage),
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
export const CopilotApiChatContext = z.union([
    z.object({
        type: z.literal('chat'),
        messages: z.array(AgenticAPIChatMessage),
    }),
    z.object({
        type: z.literal('agent'),
        agentName: z.string(),
    }),
    z.object({
        type: z.literal('tool'),
        toolName: z.string(),
    }),
    z.object({
        type: z.literal('prompt'),
        promptName: z.string(),
    }),
]);
export const CopilotAPIRequest = z.object({
    messages: z.array(CopilotApiMessage),
    workflow_schema: z.string(),
    current_workflow_config: z.string(),
    context: CopilotApiChatContext.nullable(),
    dataSources: z.array(CopilotDataSource).optional(),
});
export const CopilotAPIResponse = z.union([
    z.object({
        response: z.string(),
    }),
    z.object({
        error: z.string(),
    }),
]);
export function convertToCopilotApiChatContext(context: z.infer<typeof CopilotChatContext>): z.infer<typeof CopilotApiChatContext> {
    switch (context.type) {
        case 'chat':
            return {
                type: 'chat',
                messages: convertToAgenticAPIChatMessages(context.messages),
            };
        case 'agent':
            return {
                type: 'agent',
                agentName: context.name,
            };
        case 'tool':
            return {
                type: 'tool',
                toolName: context.name,
            };
        case 'prompt':
            return {
                type: 'prompt',
                promptName: context.name,
            };
    }
}
export function convertToCopilotApiMessage(message: z.infer<typeof CopilotMessage>): z.infer<typeof CopilotApiMessage> {
    return {
        role: message.role,
        content: JSON.stringify(message.content),
    };
}
export function convertToCopilotMessage(message: z.infer<typeof CopilotApiMessage>): z.infer<typeof CopilotMessage> {
    switch (message.role) {
        case 'assistant':
            return CopilotAssistantMessage.parse({
                role: 'assistant',
                content: JSON.parse(message.content),
            });
        case 'user':
            return {
                role: 'user',
                content: message.content,
            };
        default:
            throw new Error(`Unknown role: ${message.role}`);
    }
}
export function convertToCopilotWorkflow(workflow: z.infer<typeof Workflow>): z.infer<typeof CopilotWorkflow> {
    const { lastUpdatedAt, projectId, ...rest } = workflow;
    return {
        ...rest,
    };
}

