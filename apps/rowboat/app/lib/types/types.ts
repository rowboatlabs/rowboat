import { CoreMessage, ToolCallPart } from "ai";
import { z } from "zod";
import { apiV1 } from "rowboat-shared";

export const MCPServer = z.object({
    name: z.string(),
    url: z.string(),
});

export const PlaygroundChat = z.object({
    createdAt: z.string().datetime(),
    projectId: z.string(),
    title: z.string().optional(),
    messages: z.array(apiV1.ChatMessage),
    simulated: z.boolean().default(false).optional(),
    simulationScenario: z.string().optional(),
    simulationComplete: z.boolean().default(false).optional(),
    agenticState: z.unknown().optional(),
    systemMessage: z.string().optional(),
});

export const Webpage = z.object({
    _id: z.string(),
    title: z.string(),
    contentSimple: z.string(),
    lastUpdatedAt: z.string().datetime(),
});

export const ChatClientId = z.object({
    _id: z.string(),
    projectId: z.string(),
});

export type WithStringId<T> = T & { _id: string };

export function convertToCoreMessages(messages: z.infer<typeof apiV1.ChatMessage>[]): CoreMessage[] {
    // convert to core messages
    const coreMessages: CoreMessage[] = [];
    for (const m of messages) {
        switch (m.role) {
            case 'system':
                coreMessages.push({
                    role: 'system',
                    content: m.content,
                });
                break;
            case 'user':
                coreMessages.push({
                    role: 'user',
                    content: m.content,
                });
                break;
            case 'assistant':
                if ('tool_calls' in m) {
                    const toolCallParts: ToolCallPart[] = m.tool_calls.map((toolCall) => ({
                        type: 'tool-call',
                        toolCallId: toolCall.id,
                        toolName: toolCall.function.name,
                        args: JSON.parse(toolCall.function.arguments),
                    }));
                    if (m.content) {
                        coreMessages.push({
                            role: 'assistant',
                            content: [
                                {
                                    type: 'text',
                                    text: m.content,
                                },
                                ...toolCallParts,
                            ]
                        });
                    } else {
                        coreMessages.push({
                            role: 'assistant',
                            content: toolCallParts,
                        });
                    }
                } else {
                    coreMessages.push({
                        role: 'assistant',
                        content: m.content,
                    });
                }
                break;
            case 'tool':
                coreMessages.push({
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: m.tool_call_id,
                            toolName: m.tool_name,
                            result: JSON.parse(m.content),
                        }
                    ]
                });
                break;
        }
    }
    return coreMessages;
}

export const ApiMessage = z.union([
    apiV1.SystemMessage,
    apiV1.UserMessage,
    apiV1.AssistantMessage,
    apiV1.AssistantMessageWithToolCalls,
    apiV1.ToolMessage,
]);

export const ApiRequest = z.object({
    messages: z.array(ApiMessage),
    state: z.unknown(),
    skipToolCalls: z.boolean().nullable().optional(),
    maxTurns: z.number().nullable().optional(),
    workflowId: z.string().nullable().optional(),
    testProfileId: z.string().nullable().optional(),
});

export const ApiResponse = z.object({
    messages: z.array(ApiMessage),
    state: z.unknown(),
});
