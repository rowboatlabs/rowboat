import z from 'zod';

export const TrackScheduleSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('cron').describe('Fires at exact cron times'),
        expression: z.string().describe('5-field cron expression, quoted (e.g. "0 * * * *")'),
    }).describe('Recurring at exact times'),
    z.object({
        type: z.literal('window').describe('Fires at most once per cron occurrence, only within a time-of-day window'),
        cron: z.string().describe('5-field cron expression, quoted'),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('24h HH:MM, local time'),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('24h HH:MM, local time'),
    }).describe('Recurring within a time-of-day window'),
    z.object({
        type: z.literal('once').describe('Fires once and never again'),
        runAt: z.string().describe('ISO 8601 datetime, local time, no Z suffix (e.g. "2026-04-14T09:00:00")'),
    }).describe('One-shot future run'),
]).describe('Optional schedule. Omit entirely for manual-only tracks.');

export type TrackSchedule = z.infer<typeof TrackScheduleSchema>;

export const TrackBlockSchema = z.object({
    trackId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe('Kebab-case identifier, unique within the note file'),
    instruction: z.string().min(1).describe('What the agent should produce each run — specific, single-focus, imperative'),
    matchCriteria: z.string().optional().describe('Optional filter for event-driven tracks'),
    active: z.boolean().default(true).describe('Set false to pause without deleting'),
    schedule: TrackScheduleSchema.optional(),
    lastRunAt: z.string().optional().describe('Runtime-managed — never write this yourself'),
    lastRunId: z.string().optional().describe('Runtime-managed — never write this yourself'),
    lastRunSummary: z.string().optional().describe('Runtime-managed — never write this yourself'),
});

// Track bus events
export const TrackRunStartEvent = z.object({
    type: z.literal('track_run_start'),
    trackId: z.string(),
    filePath: z.string(),
    trigger: z.enum(['timed', 'manual', 'event']),
    runId: z.string(),
});

export const TrackRunCompleteEvent = z.object({
    type: z.literal('track_run_complete'),
    trackId: z.string(),
    filePath: z.string(),
    runId: z.string(),
    error: z.string().optional(),
    summary: z.string().optional(),
});

export const TrackEvent = z.union([TrackRunStartEvent, TrackRunCompleteEvent]);

export type TrackBlock = z.infer<typeof TrackBlockSchema>;
export type TrackEventType = z.infer<typeof TrackEvent>;
