import { z } from "zod";
import { MCPServer } from "./types";
import { Workflow, WorkflowTool } from "./workflow_types";

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

export const ComposioTrigger = z.object({
    id: z.string(),
    triggerId: z.string(),
    connectedAccountId: z.string(),
    createdAt: z.string().datetime(),
})

export const CustomMcpServer = z.object({
    serverUrl: z.string(),
});

export const Project = z.object({
    _id: z.string().uuid(),
    name: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    createdByUserId: z.string(),
    secret: z.string(),
    chatClientId: z.string(),
    draftWorkflow: Workflow.optional(),
    liveWorkflow: Workflow.optional(),
    webhookUrl: z.string().optional(),
    publishedWorkflowId: z.string().optional(),
    testRunCounter: z.number().default(0),
    mcpServers: z.array(MCPServer).optional(),
    composioConnectedAccounts: z.record(z.string(), ComposioConnectedAccount).optional(),
    composioTriggers: z.record(z.string(), ComposioTrigger).optional(),
    customMcpServers: z.record(z.string(), CustomMcpServer).optional(),
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