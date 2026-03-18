import { z } from 'zod';

export const InlineTaskScheduleSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('cron'),
        expression: z.string(),
        startDate: z.string(),
        endDate: z.string(),
    }),
    z.object({
        type: z.literal('window'),
        cron: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        startDate: z.string(),
        endDate: z.string(),
    }),
    z.object({
        type: z.literal('once'),
        runAt: z.string(),
    }),
]);

export type InlineTaskSchedule = z.infer<typeof InlineTaskScheduleSchema>;

export const InlineTaskBlockSchema = z.object({
    instruction: z.string(),
    schedule: InlineTaskScheduleSchema.optional(),
    'schedule-label': z.string().optional(),
    lastRunAt: z.string().optional(),
    processing: z.boolean().optional(),
    targetId: z.string().optional(),
});

export type InlineTaskBlock = z.infer<typeof InlineTaskBlockSchema>;
