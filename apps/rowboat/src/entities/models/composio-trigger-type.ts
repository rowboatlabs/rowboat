import { z } from "zod";

export const ComposioTriggerType = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    config: z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), z.any()),
        required: z.array(z.string()).optional(),
        title: z.string().optional(),
    }),
});