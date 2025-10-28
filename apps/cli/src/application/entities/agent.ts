import { z } from "zod";
export const Agent = z.object({
    name: z.string(),
    model: z.string(),
    description: z.string(),
    instructions: z.string(),
});
