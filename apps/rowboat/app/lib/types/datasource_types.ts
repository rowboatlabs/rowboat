import { z } from "zod";

export const EmbeddingRecord = z.object({
    id: z.string().uuid(),
    vector: z.array(z.number()),
    payload: z.object({
        projectId: z.string(),
        sourceId: z.string(),
        docId: z.string(),
        content: z.string(),
        title: z.string(),
        name: z.string(),
    }),
});