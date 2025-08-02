import { z } from "zod";

export const Conversation = z.object({
    id: z.string(),
    projectId: z.string(),
    createdAt: z.date(),
});