import { MCPServer } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { z } from "zod";

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

export const CustomMcpServer = z.object({
    serverUrl: z.string(),
});

export const Project = z.object({
    id: z.string().uuid(),
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
    customMcpServers: z.record(z.string(), CustomMcpServer).optional(),
});