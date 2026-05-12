import { PrefixLogger } from '@x/shared';
import * as workspace from '../../workspace/workspace.js';
import { fetchLiveNote } from './fileops.js';
import { runLiveNoteAgent } from './runner.js';
import { backoffRemainingMs, dueTimedTrigger } from '../../schedule/utils.js';

const log = new PrefixLogger('LiveNote:Scheduler');
const POLL_INTERVAL_MS = 15_000; // 15 seconds

async function listKnowledgeMarkdownFiles(): Promise<string[]> {
    try {
        const entries = await workspace.readdir('knowledge', { recursive: true });
        return entries
            .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
            .map(e => e.path.replace(/^knowledge\//, ''));
    } catch {
        return [];
    }
}

function humanMs(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return `${m}m`;
}

async function processScheduledLiveNotes(): Promise<void> {
    const relativePaths = await listKnowledgeMarkdownFiles();

    let liveCount = 0;
    let pausedCount = 0;
    let firedCount = 0;
    let backoffCount = 0;

    for (const relativePath of relativePaths) {
        let live;
        try {
            live = await fetchLiveNote(relativePath);
        } catch {
            continue;
        }
        if (!live) continue;
        liveCount++;

        if (live.active === false) {
            pausedCount++;
            continue;
        }

        const source = dueTimedTrigger(live.triggers, live.lastRunAt ?? null);
        if (!source) continue;

        // Cycle is ready to fire — but check backoff before triggering. This is
        // the disk-persistent backstop; the runner's in-memory concurrency
        // guard covers the common in-flight case.
        const backoffMs = backoffRemainingMs(live.lastAttemptAt ?? null);
        if (backoffMs > 0) {
            backoffCount++;
            log.log(`${relativePath} — skip (matched ${source}, backoff ${humanMs(backoffMs)} remaining)`);
            continue;
        }

        firedCount++;
        log.log(`${relativePath} — firing (matched ${source})`);
        runLiveNoteAgent(relativePath, source).catch(err => {
            log.log(`${relativePath} — fire error: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    // One summary line per tick — keeps logs scannable without spamming a row
    // per inactive note.
    if (liveCount > 0 || firedCount > 0 || backoffCount > 0) {
        log.log(
            `tick — scanned ${relativePaths.length} md, ${liveCount} live` +
            (pausedCount > 0 ? `, ${pausedCount} paused` : '') +
            (firedCount > 0 ? `, fired ${firedCount}` : '') +
            (backoffCount > 0 ? `, backoff ${backoffCount}` : ''),
        );
    }
}

export async function init(): Promise<void> {
    log.log(`starting, polling every ${POLL_INTERVAL_MS / 1000}s`);

    await processScheduledLiveNotes();

    while (true) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
            await processScheduledLiveNotes();
        } catch (error) {
            log.log(`tick error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
