import { z } from "zod";

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

const mockToolConfig = z.object({
    mockInstructions: z.string(),
});

const baseToolRef = z.object({
    name: z.string(),
});

const mockToolRef = baseToolRef.extend({
    type: z.literal('mock'),
    config: mockToolConfig,
});

const mcpToolRef = baseToolRef.extend({
    type: z.literal('mcp'),
    config: mcpToolConfig,
});

const composioToolRef = baseToolRef.extend({
    type: z.literal('composio'),
    config: composioToolConfig,
});

const agentToolRef = baseToolRef.extend({
    type: z.literal('agent'),
    config: agentToolConfig,
});

const workflowToolRef = baseToolRef.extend({
    type: z.literal('workflow'),
    config: workflowToolConfig,
});

export const ToolRef = z.union([
    mockToolRef,
    mcpToolRef,
    composioToolRef,
    agentToolRef,
    workflowToolRef,
]);

export const AgentVersion = z.object({
    id: z.string(),
    agentId: z.string(),
    version: z.string(),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    toolRefs: z.array(ToolRef),
    createdAt: z.string().datetime(),
});