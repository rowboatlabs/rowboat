import { z } from "zod";

export const DataSourceDoc = z.object({
    sourceId: z.string(),
    name: z.string(),
    version: z.number(),
    status: z.union([
        z.literal('pending'),
        z.literal('ready'),
        z.literal('error'),
        z.literal('deleted'),
    ]),
    content: z.string().optional(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime().optional(),
    error: z.string().optional(),
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