import { z } from "zod";

export const DataSource = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    projectId: z.string(),
    active: z.boolean().default(true),
    status: z.enum([
        'pending',
        'ready',
        'error',
        'deleted',
    ]),
    version: z.number(),
    error: z.string().optional(),
    billingError: z.string().optional(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime().optional(),
    attempts: z.number(),
    lastAttemptAt: z.string().datetime().optional(),
    pendingRefresh: z.boolean().default(false).optional(),
    data: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('urls'),
        }),
        z.object({
            type: z.literal('files_local'),
        }),
        z.object({
            type: z.literal('files_s3'),
        }),
        z.object({
            type: z.literal('text'),
        })
    ]),
});