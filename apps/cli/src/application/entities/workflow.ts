import { z } from "zod";

const AgentStep = z.object({
    type: z.literal("agent"),
    id: z.string(),
});

const FunctionStep = z.object({
    type: z.literal("function"),
    id: z.string(),
});

const Step = z.discriminatedUnion("type", [AgentStep, FunctionStep]);

export const Workflow = z.object({
    name: z.string(),
    description: z.string(),
    steps: z.array(Step),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});