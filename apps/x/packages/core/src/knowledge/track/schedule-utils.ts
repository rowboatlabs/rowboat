import { CronExpressionParser } from 'cron-parser';
import type { TrackSchedule } from '@x/shared/dist/track-block.js';

const GRACE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Determine if a scheduled track is due to run.
 * All schedule types enforce a 2-minute grace period — if the scheduled time
 * was more than 2 minutes ago, it's considered a miss and skipped.
 */
export function isTrackScheduleDue(schedule: TrackSchedule, lastRunAt: string | null): boolean {
    const now = new Date();

    switch (schedule.type) {
        case 'cron': {
            if (!lastRunAt) return true; // Never ran — immediately due
            try {
                const interval = CronExpressionParser.parse(schedule.expression, {
                    currentDate: new Date(lastRunAt),
                });
                const nextRun = interval.next().toDate();
                return now >= nextRun && now.getTime() <= nextRun.getTime() + GRACE_MS;
            } catch {
                return false;
            }
        }
        case 'window': {
            if (!lastRunAt) {
                // Never ran — due if within the time window now
                const [startHour, startMin] = schedule.startTime.split(':').map(Number);
                const [endHour, endMin] = schedule.endTime.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
            }
            try {
                const interval = CronExpressionParser.parse(schedule.cron, {
                    currentDate: new Date(lastRunAt),
                });
                const nextRun = interval.next().toDate();
                if (!(now >= nextRun && now.getTime() <= nextRun.getTime() + GRACE_MS)) {
                    return false;
                }

                // Check if current time is within the time window
                const [startHour, startMin] = schedule.startTime.split(':').map(Number);
                const [endHour, endMin] = schedule.endTime.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                const nowMinutes = now.getHours() * 60 + now.getMinutes();

                return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
            } catch {
                return false;
            }
        }
        case 'once': {
            if (lastRunAt) return false; // Already ran
            const runAt = new Date(schedule.runAt);
            return now >= runAt && now.getTime() <= runAt.getTime() + GRACE_MS;
        }
    }
}
