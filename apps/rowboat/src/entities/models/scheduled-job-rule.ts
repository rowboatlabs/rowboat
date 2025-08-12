import { Message } from "@/app/lib/types/types";
import { z } from "zod";

export const ScheduledJobRule = z.object({
    id: z.string(),
    projectId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    nextRunAt: z.string().datetime(),
    workerId: z.string().nullable(),
    lastWorkerId: z.string().nullable(),
    processedAt: z.string().datetime().nullable(),
    jobId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    disabled: z.boolean(),
})