import { z } from 'zod';

export const UserConfig = z.object({
    name: z.string(),
    email: z.string().email(),
    domain: z.string(),
});

export type UserConfig = z.infer<typeof UserConfig>;

export const PreBuiltAgentConfig = z.object({
    enabled: z.boolean().default(false),
    intervalMs: z.number().default(5 * 60 * 1000), // 5 minutes default
});

export type PreBuiltAgentConfig = z.infer<typeof PreBuiltAgentConfig>;

export const PreBuiltConfig = z.object({
    agents: z.record(z.string(), PreBuiltAgentConfig).default({}),
});

export type PreBuiltConfig = z.infer<typeof PreBuiltConfig>;

export const PreBuiltState = z.object({
    lastRunTimes: z.record(z.string(), z.string()).default({}), // agentName -> ISO timestamp
});

export type PreBuiltState = z.infer<typeof PreBuiltState>;

// Registry of available pre-built agents
export const PREBUILT_AGENTS = [
    'meeting-prep',
    'email-draft',
] as const;

export type PreBuiltAgentName = typeof PREBUILT_AGENTS[number];
