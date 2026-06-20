import { z } from 'zod';

export const KnowledgeSourceProvider = z.enum([
    'gmail',
    'meeting',
    'voice_memo',
    'slack',
    'github',
    'linear',
]);
export type KnowledgeSourceProvider = z.infer<typeof KnowledgeSourceProvider>;

export const KnowledgeSourceScope = z.object({
    type: z.string(),
    id: z.string(),
    name: z.string().optional(),
    workspaceUrl: z.string().optional(),
});
export type KnowledgeSourceScope = z.infer<typeof KnowledgeSourceScope>;

export const KnowledgeSourceConfig = z.object({
    id: z.string(),
    provider: KnowledgeSourceProvider,
    enabled: z.boolean(),
    artifactDir: z.string(),
    syncMode: z.enum(['file', 'poll', 'event', 'manual']).default('file'),
    intervalMs: z.number().int().positive().optional(),
    scopes: z.array(KnowledgeSourceScope).default([]),
    instructions: z.string().optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
});
export type KnowledgeSourceConfig = z.infer<typeof KnowledgeSourceConfig>;

export const KnowledgeSourcesFile = z.object({
    sources: z.array(KnowledgeSourceConfig),
});
export type KnowledgeSourcesFile = z.infer<typeof KnowledgeSourcesFile>;

export interface KnowledgeArtifact {
    sourceId: string;
    provider: KnowledgeSourceProvider;
    externalId: string;
    version: string;
    occurredAt: string;
    title: string;
    bodyMarkdown: string;
    url?: string;
    metadata: Record<string, unknown>;
}
