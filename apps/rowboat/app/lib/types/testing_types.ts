import { z } from "zod";

// Base type

export const Scenario = z.object({
    projectId: z.string(),
    name: z.string().min(1, "Name cannot be empty"),
    description: z.string().min(1, "Description cannot be empty"),
    criteria: z.string().default(''),
    context: z.string().default(''),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

// Relevant to new simulation features

export const SimulationScenarioData = z.object({
    scenario: z.string(),
    context: z.string().default(''),
});

// Legacy

export const SimulationArticleData = z.object({
    articleUrl: z.string(),
    articleTitle: z.string().default('').optional(),
    articleContent: z.string().default('').optional(),
});

export const SimulationChatMessagesData = z.object({
    chatMessages: z.string(),
});

// Relevant to new simulation features

export const SimulationData = z.union([
    SimulationScenarioData,
    SimulationArticleData,
    SimulationChatMessagesData
]);

export const SimulationAggregateResult = z.object({
    total: z.number(),
    pass: z.number(),
    fail: z.number(),
});

export const SimulationRun = z.object({
    projectId: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'cancelled', 'failed']),
    scenarioIds: z.array(z.string()),
    workflowId: z.string(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    aggregateResults: SimulationAggregateResult.optional(),
});

export const SimulationResult = z.object({
    projectId: z.string(),
    runId: z.string(),
    scenarioId: z.string(),
    result: z.union([z.literal('pass'), z.literal('fail')]),
    details: z.string()
});