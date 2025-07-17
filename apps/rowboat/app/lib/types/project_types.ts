import { z } from "zod";
import { MCPServer } from "./types";
import { WorkflowTool } from "./workflow_types";
import { ZTool } from "../composio/composio";

export const ComposioConnectedAccount = z.object({
    id: z.string(),
    authConfigId: z.string(),
    status: z.enum([
        'INITIATED',
        'ACTIVE',
        'FAILED',
    ]),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

export const ComposioMockToolkitState = z.object({
    toolkitSlug: z.string(),
    isMocked: z.boolean(),
    mockInstructions: z.string().optional(),
    autoSubmitMockedResponse: z.boolean().default(false),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

export const Project = z.object({
    _id: z.string().uuid(),
    name: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    createdByUserId: z.string(),
    secret: z.string(),
    chatClientId: z.string(),
    webhookUrl: z.string().optional(),
    publishedWorkflowId: z.string().optional(),
    nextWorkflowNumber: z.number().optional(),
    testRunCounter: z.number().default(0),
    mcpServers: z.array(MCPServer).optional(),
    composioConnectedAccounts: z.record(z.string(), ComposioConnectedAccount).optional(),
    composioSelectedTools: z.array(ZTool).optional(),
    composioMockToolkitStates: z.record(z.string(), ComposioMockToolkitState).optional(),
});

export const ProjectMember = z.object({
    userId: z.string(),
    projectId: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

export const ApiKey = z.object({
    projectId: z.string(),
    key: z.string(),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().optional(),
});

export function mergeProjectTools(
    workflowTools: z.infer<typeof WorkflowTool>[],
    projectTools: z.infer<typeof WorkflowTool>[]
): z.infer<typeof WorkflowTool>[] {
    // Filter out any existing MCP tools from workflow tools
    const nonMcpTools = workflowTools.filter(t => !t.isMcp);

    // Merge with project tools
    const merged = [
        ...nonMcpTools,
        ...projectTools
    ];

    return merged;
}
