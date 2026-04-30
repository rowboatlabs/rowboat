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
                // Find the MOST RECENT occurrence at-or-before `now`, not the
                // occurrence right after lastRunAt. If lastRunAt is old, that
                // occurrence would be ancient too and always fall outside the
                // grace window, blocking every future fire.
                const interval = CronExpressionParser.parse(schedule.expression, {
                    currentDate: now,
                });
                const prevRun = interval.prev().toDate();

                // Already ran at-or-after this occurrence → skip.
                if (new Date(lastRunAt).getTime() >= prevRun.getTime()) return false;

                // Within grace → fire. Outside grace → missed, skip.
                return now.getTime() <= prevRun.getTime() + GRACE_MS;
            } catch {
                return false;
            }
        }
        case 'window': {
            // Time-of-day filter (applies regardless of lastRunAt state).
            const [startHour, startMin] = schedule.startTime.split(':').map(Number);
            const [endHour, endMin] = schedule.endTime.split(':').map(Number);
            const startMinutes = startHour * 60 + startMin;
            const endMinutes = endHour * 60 + endMin;
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            if (nowMinutes < startMinutes || nowMinutes > endMinutes) return false;

            if (!lastRunAt) return true;
            try {
                const interval = CronExpressionParser.parse(schedule.cron, {
                    currentDate: now,
                });
                const prevRun = interval.prev().toDate();
                if (new Date(lastRunAt).getTime() >= prevRun.getTime()) return false;
                return now.getTime() <= prevRun.getTime() + GRACE_MS;
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
