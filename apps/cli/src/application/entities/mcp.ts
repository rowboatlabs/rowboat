import z from "zod";

const StdioMcpServerConfig = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
});

const HttpMcpServerConfig = z.object({
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

export const McpServerConfig = z.object({
    mcpServers: z.record(z.string(), z.union([StdioMcpServerConfig, HttpMcpServerConfig])),
});