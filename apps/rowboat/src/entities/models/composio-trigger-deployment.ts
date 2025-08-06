import { z } from "zod";

export const ComposioTriggerDeployment = z.object({
    id: z.string(),
    projectId: z.string(),
    triggerId: z.string(),
    triggerTypeSlug: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});