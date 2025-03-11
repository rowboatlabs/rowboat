import { z } from "zod";

export const TestScenario = z.object({
    projectId: z.string(),
    name: z.string().min(1, "Name cannot be empty"),
    description: z.string().min(1, "Description cannot be empty"),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

export const TestProfile = z.object({
    projectId: z.string(),
    name: z.string().min(1, "Name cannot be empty"),
    context: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    mockTools: z.boolean(),
    mockPrompt: z.string().optional(),
});

export const TestSimulation = z.object({
    projectId: z.string(),
    name: z.string(),
    description: z.string().optional().nullable(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    scenarioId: z.string(),
    profileId: z.string().nullable(),
    passCriteria: z.string(),
});

export const TestRun = z.object({
    projectId: z.string(),
    name: z.string(),
    simulationIds: z.array(z.string()),
    workflowId: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'cancelled', 'failed', 'error']),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    aggregateResults: z.object({
      total: z.number(),
      passCount: z.number(),
      failCount: z.number(),
    }).optional(),
});

export const TestResult = z.object({
    projectId: z.string(),
    runId: z.string(),
    simulationId: z.string(),
    result: z.union([z.literal('pass'), z.literal('fail')]),
    details: z.string(),
    transcript: z.string()
});