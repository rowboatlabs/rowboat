import { z } from "zod";

export const PaginatedList = <T extends z.ZodTypeAny>(schema: T) => z.object({
    items: z.array(schema),
    nextCursor: z.string().nullable(),
});