import { CoreMessage, ToolCallPart } from "ai";
import { z } from "zod";
import { apiV1 } from "rowboat-shared";
import { WorkflowTool } from "./workflow_types";

export const McpToolInputSchema = z.object({
    type: z.literal('object'),
    properties: z.record(z.object({
        type: z.string(),
        description: z.string(),
        enum: z.array(z.any()).optional(),
        default: z.any().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        items: z.any().optional(),  // For array types
        format: z.string().optional(),
        pattern: z.string().optional(),
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        minItems: z.number().optional(),
        maxItems: z.number().optional(),
        uniqueItems: z.boolean().optional(),
        multipleOf: z.number().optional(),
        examples: z.array(z.any()).optional(),
    })).default({}),
    required: z.array(z.string()).default([]),
});

export const McpServerTool = z.object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: McpToolInputSchema.optional(),
});

export const McpTool = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    parameters: z.object({
        type: z.literal('object'),
        properties: z.record(z.object({
            type: z.string(),
            description: z.string(),
        })),
        required: z.array(z.string()).optional(),
    }).optional(),
});

export const MCPServer = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tools: z.array(McpTool),  // Selected tools from MongoDB
    availableTools: z.array(McpTool).optional(),  // Available tools from Klavis
    isActive: z.boolean().optional(),
    isReady: z.boolean().optional(),
    authNeeded: z.boolean().optional(),
    isAuthenticated: z.boolean().optional(),
    requiresAuth: z.boolean().optional(),
    serverUrl: z.string().optional(),
    instanceId: z.string().optional(),
    serverName: z.string().optional(),
    serverType: z.enum(['hosted', 'custom']).optional(),
});

// Minimal MCP server info needed by agents service
export const MCPServerMinimal = z.object({
    name: z.string(),
    serverUrl: z.string(),
    isReady: z.boolean().optional(),
});

// Response types for Klavis API
export const McpServerResponse = z.object({
    data: z.array(z.lazy(() => MCPServer)).nullable(),
    error: z.string().nullable(),
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
    workflowId: z.string().nullable().optional(),
    testProfileId: z.string().nullable().optional(),
});

export const ApiResponse = z.object({
    messages: z.array(ApiMessage),
    state: z.unknown(),
});

// Helper function to convert MCP server tool to WorkflowTool
export function convertMcpServerToolToWorkflowTool(
    mcpTool: z.infer<typeof McpServerTool>,
    mcpServer: z.infer<typeof MCPServer>
): z.infer<typeof WorkflowTool> {
    // Parse the input schema, handling both string and object formats
    let parsedSchema;
    if (typeof mcpTool.inputSchema === 'string') {
        try {
            parsedSchema = JSON.parse(mcpTool.inputSchema);
        } catch (e) {
            console.error('Failed to parse inputSchema string:', e);
            parsedSchema = {
                type: 'object',
                properties: {},
                required: []
            };
        }
    } else {
        parsedSchema = mcpTool.inputSchema ?? {
            type: 'object',
            properties: {},
            required: []
        };
    }

    // Ensure the schema is valid
    const inputSchema = McpToolInputSchema.parse(parsedSchema);

    const converted = {
        name: mcpTool.name,
        description: mcpTool.description ?? "",
        parameters: inputSchema,
        isMcp: true,
        mcpServerName: mcpServer.name,
        mcpServerURL: mcpServer.serverUrl,
    };

    return converted;
}
