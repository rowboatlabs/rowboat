import { z } from "zod";

export const Agent = z.object({
    id: z.string(),
    tenantId: z.string(),
    currentVersion: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});