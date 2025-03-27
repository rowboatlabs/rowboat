import { z } from "zod";
import { MCPServer } from "@/app/lib/types/types";

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