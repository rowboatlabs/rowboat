import { z } from "zod";

export const DataSourceDoc = z.object({
    id: z.string(),
    sourceId: z.string(),
    projectId: z.string(),
    name: z.string(),
    version: z.number(),
    status: z.enum([
        'pending',
        'ready',
        'error',
        'deleted',
    ]),
    content: z.string().nullable(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime().nullable(),
    attempts: z.number(),
    error: z.string().nullable(),
    data: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('url'),
            url: z.string(),
        }),
        z.object({
            type: z.literal('file_local'),
            name: z.string(),
            size: z.number(),
            mimeType: z.string(),
        }),
        z.object({
            type: z.literal('file_s3'),
            name: z.string(),
            size: z.number(),
            mimeType: z.string(),
            s3Key: z.string(),
        }),
        z.object({
            type: z.literal('text'),
            content: z.string(),
        }),
    ]),
});