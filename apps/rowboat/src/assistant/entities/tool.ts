import { z } from "zod";

const baseTool = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
});

const mcpToolConfig = z.object({
    serverId: z.string(),
});

const composioToolConfig = z.object({
    toolkitSlug: z.string(),
    toolSlug: z.string(),
    noAuth: z.boolean(),
    connectedAccountId: z.string().nullable().optional(),
});

const agentToolConfig = z.object({
    agentId: z.string(),
});

const workflowToolConfig = z.object({
    workflowId: z.string(),
});

export const McpTool = baseTool.extend({
    type: z.literal('mcp'),
    config: mcpToolConfig,
});

const ComposioTool = baseTool.extend({
    type: z.literal('composio'),
    config: composioToolConfig,
});

const AgentTool = baseTool.extend({
    type: z.literal('agent'),
    config: agentToolConfig,
});

const WorkflowTool = baseTool.extend({
    type: z.literal('workflow'),
    config: workflowToolConfig,
});

export const Tool = z.union([
    McpTool,
    ComposioTool,
    AgentTool,
    WorkflowTool,
]);