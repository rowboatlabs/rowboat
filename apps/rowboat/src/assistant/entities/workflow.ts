import { z } from "zod";

const baseNode = z.object({
    id: z.string(),
});

const agentNodeConfig = z.object({
    agentId: z.string(),
});

const startNode = baseNode.extend({ 
    type: z.literal('start'),
});

const endNode = baseNode.extend({
    type: z.literal('end'),
});

const agentNode = baseNode.extend({
    type: z.literal('agent'),
    config: agentNodeConfig,
});

export const Node = z.union([
    startNode,
    endNode,
    agentNode,
]);

export const Edge = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
});

export const Workflow = z.object({
    id: z.string(),
    tenantId: z.string(),
    currentVersion: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});

export const WorkflowVersion = z.object({
    id: z.string(),
    workflowId: z.string(),
    tenantId: z.string(),
    version: z.string(),
    name: z.string(),
    description: z.string(),
    nodes: z.array(Node),
    edges: z.array(Edge),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});