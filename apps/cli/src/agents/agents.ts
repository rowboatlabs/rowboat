import { z } from "zod";

export const BaseTool = z.object({
    name: z.string(),
});

export const BuiltinTool = BaseTool.extend({
    type: z.literal("builtin"),
});

export const McpTool = BaseTool.extend({
    type: z.literal("mcp"),
    description: z.string(),
    inputSchema: z.any(),
    mcpServerName: z.string(),
});

export const AgentAsATool = BaseTool.extend({
    type: z.literal("agent"),
});

export const ToolAttachment = z.discriminatedUnion("type", [
    BuiltinTool,
    McpTool,
    AgentAsATool,
]);

export const Agent = z.object({
    name: z.string(),
    provider: z.string().optional(),
    model: z.string().optional(),
    description: z.string().optional(),
    instructions: z.string(),
    tools: z.record(z.string(), ToolAttachment).optional(),
});
