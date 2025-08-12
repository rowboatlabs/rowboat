import { Message } from "@/app/lib/types/types";
import { z } from "zod";

export const RecurringJobRule = z.object({
    id: z.string(),
    projectId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    cron: z.string(), // a cron expression with at most minute-level resolution
    nextRunAt: z.string().datetime(), // when is the next time this cron should run
    workerId: z.string().nullable(), // set if currently locked by a worker
    lastWorkerId: z.string().nullable(),
    disabled: z.boolean(), // disabled rule - do not process
    lastProcessedAt: z.string().datetime().optional(), // when was it last processed
    lastError: z.string().optional(), // error msg if generated during last process
    createdAt: z.string(),
    updatedAt: z.string().optional(),
});