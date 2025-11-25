import { z } from "zod";

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
