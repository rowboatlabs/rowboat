import { PrefixLogger } from '@x/shared';
import { listTasks } from './fileops.js';
import { runBackgroundTask } from './runner.js';
import { backoffRemainingMs, dueTimedTrigger } from '../schedule/utils.js';

const log = new PrefixLogger('BgTask:Scheduler');
const POLL_INTERVAL_MS = 15_000; // 15 seconds — matches live-note scheduler

function humanMs(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return `${m}m`;
}

async function processScheduledTasks(): Promise<void> {
    const { items } = await listTasks({ limit: 10_000 });

    let scannedCount = items.length;
    let activeCount = 0;
    let pausedCount = 0;
    let firedCount = 0;
    let backoffCount = 0;
    let inFlightCount = 0;

    for (const task of items) {
        if (!task.active) {
            pausedCount++;
            continue;
        }
        activeCount++;

        // In-flight skip — `lastAttemptAt` set more recently than `lastRunAt`
        // means the latest attempt never completed. The in-memory concurrency
        // guard in the runner is the fast path; this is the disk-persistent
        // backstop covering crashes mid-run.
        const attemptAt = task.lastAttemptAt;
        const completedAt = task.lastRunAt;
        if (attemptAt && (!completedAt || attemptAt > completedAt)) {
            // …but only treat as in-flight if the attempt is still within the
            // backoff window. After backoff expires the next iteration is free
            // to retry (matches the runner's fail/crash recovery story).
            if (backoffRemainingMs(attemptAt) > 0) {
                inFlightCount++;
                continue;
            }
        }

        // Cycle anchor: only successful runs advance the cycle. Failures
        // leave the cycle unfired so the next natural occurrence retries
        // (gated by backoff).
        const source = dueTimedTrigger(task.triggers, completedAt ?? null);
        if (!source) continue;

        const backoffMs = backoffRemainingMs(attemptAt ?? null);
        if (backoffMs > 0) {
            backoffCount++;
            log.log(`${task.slug} — skip (matched ${source}, backoff ${humanMs(backoffMs)} remaining)`);
            continue;
        }

        firedCount++;
        log.log(`${task.slug} — firing (matched ${source})`);
        runBackgroundTask(task.slug, source).catch(err => {
            log.log(`${task.slug} — fire error: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    if (activeCount > 0 || firedCount > 0 || backoffCount > 0 || inFlightCount > 0) {
        log.log(
            `tick — scanned ${scannedCount} tasks, ${activeCount} active` +
            (pausedCount > 0 ? `, ${pausedCount} paused` : '') +
            (inFlightCount > 0 ? `, ${inFlightCount} in-flight` : '') +
            (firedCount > 0 ? `, fired ${firedCount}` : '') +
            (backoffCount > 0 ? `, backoff ${backoffCount}` : ''),
        );
    }
}

export async function init(): Promise<void> {
    log.log(`starting, polling every ${POLL_INTERVAL_MS / 1000}s`);

    await processScheduledTasks();

    while (true) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
            await processScheduledTasks();
        } catch (err) {
            log.log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
