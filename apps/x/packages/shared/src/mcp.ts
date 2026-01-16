import z from "zod";

export const StdioMcpServerConfig = z.object({
    type: z.literal("stdio").optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
});

export const HttpMcpServerConfig = z.object({
    type: z.literal("http").optional(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

export const McpServerDefinition = z.union([StdioMcpServerConfig, HttpMcpServerConfig]);

export const McpServerConfig = z.object({
    mcpServers: z.record(z.string(), McpServerDefinition),
});

export const connectionState = z.enum(["disconnected", "connected", "error"]);

export const McpServerList = z.object({
    mcpServers: z.record(z.string(), z.object({
        config: McpServerDefinition,
        state: connectionState,
        error: z.string().nullable(),
    })),
});

export const Tool = z.object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.object({
        type: z.literal("object"),
        properties: z.record(z.string(), z.any()).optional(),
        required: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
        type: z.literal("object"),
        properties: z.record(z.string(), z.any()).optional(),
        required: z.array(z.string()).optional(),
    }).optional(),
});

export const ListToolsResponse = z.object({
    tools: z.array(Tool),
    nextCursor: z.string().optional(),
});