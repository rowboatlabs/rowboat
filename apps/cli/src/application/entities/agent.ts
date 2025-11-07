import { z } from "zod";

export const BaseAgentTool = z.object({
    name: z.string(),
    type: z.enum([
        "builtin",
        "mcp",
    ]),
});

export const BuiltinAgentTool = BaseAgentTool.extend({
    type: z.literal("builtin"),
    name: z.string(),
});

export const McpAgentTool = BaseAgentTool.extend({
    type: z.literal("mcp"),
    name: z.string(),
    description: z.string(),
    inputSchema: z.any(),
    mcpServerName: z.string(),
});

export const AgentTool = z.discriminatedUnion("type", [
    BuiltinAgentTool,
    McpAgentTool,
]);

export const Agent = z.object({
    name: z.string(),
    model: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.record(z.string(), AgentTool),
});
