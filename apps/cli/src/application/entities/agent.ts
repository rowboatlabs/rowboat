import { z } from "zod";

export const BaseAgentTool = z.object({
    name: z.string(),
});

export const BuiltinAgentTool = BaseAgentTool.extend({
    type: z.literal("builtin"),
});

export const McpAgentTool = BaseAgentTool.extend({
    type: z.literal("mcp"),
    description: z.string(),
    inputSchema: z.any(),
    mcpServerName: z.string(),
});

export const WorkflowAgentTool = BaseAgentTool.extend({
    type: z.literal("workflow"),
});

export const AgentTool = z.discriminatedUnion("type", [
    BuiltinAgentTool,
    McpAgentTool,
    WorkflowAgentTool,
]);

export const Agent = z.object({
    name: z.string(),
    model: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.record(z.string(), AgentTool).optional(),
});
