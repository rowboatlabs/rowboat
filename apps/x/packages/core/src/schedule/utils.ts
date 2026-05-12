import { CronExpressionParser } from 'cron-parser';
import type { Triggers } from '@x/shared/dist/live-note.js';

const GRACE_MS = 2 * 60 * 1000; // 2 minutes
export const RETRY_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Decide whether a `triggers` block has any timed sub-trigger (cron or window)
 * whose cycle is currently ready to fire. Pure cycle check — does NOT consider
 * backoff. Used by both the live-note scheduler and the bg-task scheduler.
 *
 * - Cycle accounting (cron prev-occurrence, window once-per-day) is anchored
 *   on `lastRunAt` — which is bumped only on *successful* completions. So a
 *   failed run leaves the cycle unfired and this returns the matched trigger
 *   again on the next tick (caller is expected to gate on backoff separately).
 * - `cronExpr` enforces a 2-minute grace window — if the scheduled time was
 *   more than 2 minutes ago, it's a miss and skipped (avoids replay storms
 *   after the app was offline).
 * - `windows` are forgiving: each window fires at most once per day per
 *   successful run, anywhere inside its time-of-day band. Cycles anchored at
 *   `startTime`. Adjacent windows sharing an endpoint (e.g. 08–12 and 12–15)
 *   each still fire on the same day.
 *
 * Returns the source ('cron' | 'window') or null if no cycle is ready.
 */
export function dueTimedTrigger(
    triggers: Triggers | undefined,
    lastRunAt: string | null,
): 'cron' | 'window' | null {
    if (!triggers) return null;

    if (triggers.cronExpr && isCronDue(triggers.cronExpr, lastRunAt)) return 'cron';

    if (triggers.windows) {
        for (const w of triggers.windows) {
            if (isWindowDue(w.startTime, w.endTime, lastRunAt)) return 'window';
        }
    }

    return null;
}

/**
 * Backoff check — has there been an attempt within `RETRY_BACKOFF_MS`?
 * Returns the milliseconds remaining until the backoff lifts (positive) or 0
 * if not in backoff. Caller logs the remaining time in human form.
 */
export function backoffRemainingMs(lastAttemptAt: string | null): number {
    if (!lastAttemptAt) return 0;
    const sinceAttempt = Date.now() - new Date(lastAttemptAt).getTime();
    if (sinceAttempt < 0 || sinceAttempt >= RETRY_BACKOFF_MS) return 0;
    return RETRY_BACKOFF_MS - sinceAttempt;
}

function isCronDue(expression: string, lastRunAt: string | null): boolean {
    const now = new Date();
    if (!lastRunAt) return true; // never ran — immediately due

    try {
        // Find the most recent occurrence at-or-before `now`, not the
        // occurrence right after lastRunAt — if lastRunAt is old, that
        // occurrence would be ancient too and always fall outside the
        // grace window, blocking every future fire.
        const interval = CronExpressionParser.parse(expression, { currentDate: now });
        const prevRun = interval.prev().toDate();

        // Already ran at-or-after this occurrence → skip.
        if (new Date(lastRunAt).getTime() >= prevRun.getTime()) return false;

        // Within grace → fire. Outside grace → missed, skip.
        return now.getTime() <= prevRun.getTime() + GRACE_MS;
    } catch {
        return false;
    }
}

function isWindowDue(startTime: string, endTime: string, lastRunAt: string | null): boolean {
    const now = new Date();
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < startMinutes || nowMinutes > endMinutes) return false;

    if (!lastRunAt) return true;

    const cycleStart = new Date(now);
    cycleStart.setHours(startHour, startMin, 0, 0);
    if (new Date(lastRunAt).getTime() > cycleStart.getTime()) return false;
    return true;
}
