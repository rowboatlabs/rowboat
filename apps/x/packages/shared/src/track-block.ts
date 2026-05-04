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
    eventMatchCriteria: z.string().optional().describe('When set, this track participates in event-based triggering. Describe what kinds of events should consider this track for an update (e.g. "Emails about Q3 planning"). Omit to disable event triggers — the track will only run on schedule or manually.'),
    active: z.boolean().default(true).describe('Set false to pause without deleting'),
    schedule: TrackScheduleSchema.optional(),
    model: z.string().optional().describe('ADVANCED — leave unset. Per-track LLM model override (e.g. "anthropic/claude-sonnet-4.6"). Only set when the user explicitly asked for a specific model for THIS track. The global default already picks a tuned model for tracks; overriding usually makes things worse, not better.'),
    provider: z.string().optional().describe('ADVANCED — leave unset. Per-track provider name override (e.g. "openai", "anthropic"). Only set when the user explicitly asked for a specific provider for THIS track. Almost always omitted; the global default flows through correctly.'),
    icon: z.string().optional().describe('Lucide icon name for the chip (e.g. "clock", "calendar-days", "mail", "history", "list-todo"). Omit to use the default icon for this track.'),
    lastRunAt: z.string().optional().describe('Runtime-managed — never write this yourself'),
    lastRunId: z.string().optional().describe('Runtime-managed — never write this yourself'),
    lastRunSummary: z.string().optional().describe('Runtime-managed — never write this yourself'),
});

// ---------------------------------------------------------------------------
// Knowledge events (event-driven track triggering pipeline)
// ---------------------------------------------------------------------------

export const KnowledgeEventSchema = z.object({
    id: z.string().describe('Monotonically increasing ID; also the filename in events/pending/'),
    source: z.string().describe('Producer of the event (e.g. "gmail", "calendar")'),
    type: z.string().describe('Event type (e.g. "email.synced")'),
    createdAt: z.string().describe('ISO timestamp when the event was produced'),
    payload: z.string().describe('Human-readable event body, usually markdown'),
    targetTrackId: z.string().optional().describe('If set, skip routing and target this track directly (used for re-runs)'),
    targetFilePath: z.string().optional(),
    // Enriched on move from pending/ to done/
    processedAt: z.string().optional(),
    candidates: z.array(z.object({
        trackId: z.string(),
        filePath: z.string(),
    })).optional(),
    runIds: z.array(z.string()).optional(),
    error: z.string().optional(),
});

export type KnowledgeEvent = z.infer<typeof KnowledgeEventSchema>;

export const Pass1OutputSchema = z.object({
    candidates: z.array(z.object({
        trackId: z.string().describe('The track block identifier'),
        filePath: z.string().describe('The note file path the track lives in'),
    })).describe('Tracks that may be relevant to this event. trackIds are only unique within a file, so always return both fields.'),
});

export type Pass1Output = z.infer<typeof Pass1OutputSchema>;

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
