import z from 'zod';

export const TrackBlockSchema = z.object({
    trackId: z.string(),
    instruction: z.string(),
    matchCriteria: z.string().optional(),
    active: z.boolean().default(true),
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
export type TrackResult = z.infer<typeof TrackResultSchema>;
export type TrackEventType = z.infer<typeof TrackEvent>;
