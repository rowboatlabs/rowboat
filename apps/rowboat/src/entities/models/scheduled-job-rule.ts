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
    status: z.enum(["pending", "processing", "triggered"]),
    output: z.object({
        error: z.string().optional(),
        jobId: z.string().optional(),
    }).optional(),
    processedAt: z.string().datetime().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
});