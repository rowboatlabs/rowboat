import { z } from "zod";

export const ComposioTriggerType = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    config: z.object({}).passthrough(),
});