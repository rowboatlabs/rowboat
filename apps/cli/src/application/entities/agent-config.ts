import { z } from "zod";

export const AgentConfig = z.object({
    description: z.string(),
    model: z.string().optional(),
    provider: z.string().optional(),
});
