import { z } from "zod";
import { Turn } from "./turn";

export const Conversation = z.object({
    id: z.string(),
    projectId: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
    turns: z.array(Turn).optional(),
});