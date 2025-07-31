import { z } from "zod";
import { Workflow, WorkflowTool } from "./workflow_types";

export const BaseMessage = z.object({
    timestamp: z.string().datetime().optional(),
});

export const SystemMessage = BaseMessage.extend({
    role: z.literal("system"),
    content: z.string(),
});

export const UserMessage = BaseMessage.extend({
    role: z.literal("user"),
    content: z.string(),
});

export const AssistantMessage = BaseMessage.extend({
    role: z.literal("assistant"),
    content: z.string(),
    agentName: z.string().nullable(),
    responseType: z.enum(['internal', 'external']),
});

export const AssistantMessageWithToolCalls = BaseMessage.extend({
    role: z.literal("assistant"),
    content: z.null(),
    toolCalls: z.array(z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
            name: z.string(),
            arguments: z.string(),
        }),
    })),
    agentName: z.string().nullable(),
});

export const ToolMessage = BaseMessage.extend({
    role: z.literal("tool"),
    content: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
});

export const Message = z.union([
    SystemMessage,
    UserMessage,
    AssistantMessage,
    AssistantMessageWithToolCalls,
    ToolMessage,
]);

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

export const User = z.object({
    auth0Id: z.string(),
    billingCustomerId: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
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

export const ApiRequest = z.object({
    messages: z.array(Message),
    state: z.unknown(),
    testProfileId: z.string().nullable().optional(),
    mockTools: z.record(z.string(), z.string()).nullable().optional(),
});

export const ApiResponse = z.object({
    messages: z.array(Message),
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
export const ZStreamAgentResponsePayload = z.object({
  projectId: z.string(),
  workflow: Workflow,
  messages: z.array(Message),
});
