import { z } from "zod";

export const DataSource = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    projectId: z.string(),
    active: z.boolean().default(true),
    status: z.enum([
        'pending',
        'ready',
        'error',
        'deleted',
    ]),
    version: z.number(),
    error: z.string().nullable(),
    billingError: z.string().nullable(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime().nullable(),
    attempts: z.number(),
    lastAttemptAt: z.string().datetime().nullable(),
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