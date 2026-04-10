import z from 'zod';

export const TrackScheduleSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('cron'),
        expression: z.string(),
    }),
    z.object({
        type: z.literal('window'),
        cron: z.string(),
        startTime: z.string(),
        endTime: z.string(),
    }),
    z.object({
        type: z.literal('once'),
        runAt: z.string(),
    }),
]);

export type TrackSchedule = z.infer<typeof TrackScheduleSchema>;

export const TrackBlockSchema = z.object({
    trackId: z.string(),
    instruction: z.string(),
    matchCriteria: z.string().optional(),
    active: z.boolean().default(true),
    schedule: TrackScheduleSchema.optional(),
    lastRunAt: z.string().optional(),
    lastRunId: z.string().optional(),
    lastRunSummary: z.string().optional(),
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
