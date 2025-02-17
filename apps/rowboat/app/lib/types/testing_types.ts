import { z } from "zod";

export const Scenario = z.object({
    projectId: z.string(),
    name: z.string().min(1, "Name cannot be empty"),
    description: z.string().min(1, "Description cannot be empty"),
    criteria: z.string().default(''),
    context: z.string().default(''),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

export const SimulationArticleData = z.object({
    articleUrl: z.string(),
    articleTitle: z.string().default('').optional(),
    articleContent: z.string().default('').optional(),
});

export const SimulationScenarioData = z.object({
    scenario: z.string(),
    context: z.string().default(''),
});

export const SimulationChatMessagesData = z.object({
    chatMessages: z.string(),
});

export const SimulationData = z.union([SimulationArticleData, SimulationScenarioData, SimulationChatMessagesData]);

// Relevant to simulation batch runs feature

export const SimulationAggregateResult = z.object({
    total: z.number(),
    pass: z.number(),
    fail: z.number(),
});

export const SimulationRun = z.object({
    projectId: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'cancelled', 'failed']),
    scenarioIds: z.array(z.string()),
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