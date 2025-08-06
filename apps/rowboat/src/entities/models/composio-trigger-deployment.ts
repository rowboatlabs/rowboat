import { z } from "zod";

export const ComposioTriggerDeployment = z.object({
    id: z.string(),
    projectId: z.string(),
    triggerId: z.string(),
    triggerTypeSlug: z.string(),
    connectedAccountId: z.string(),
    triggerConfig: z.record(z.string(), z.unknown()),
    disabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});