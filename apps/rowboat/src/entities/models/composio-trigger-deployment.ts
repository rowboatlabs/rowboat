import { z } from "zod";

export const ComposioTriggerDeployment = z.object({
    id: z.string(),
    projectId: z.string(),
    triggerId: z.string(),
    toolkitSlug: z.string(),
    triggerTypeSlug: z.string(),
    connectedAccountId: z.string(),
    triggerConfig: z.record(z.string(), z.unknown()),
    logo: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});