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
    lastUpdatedAt: z.string().datetime().optional(),
    createdByUserId: z.string(),
    secret: z.string(),
    draftWorkflow: Workflow,
    liveWorkflow: Workflow,
    webhookUrl: z.string().optional(),
    composioConnectedAccounts: z.record(z.string(), ComposioConnectedAccount).optional(),
    customMcpServers: z.record(z.string(), CustomMcpServer).optional(),
});