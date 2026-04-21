import { PrefixLogger } from '@x/shared';
import * as workspace from '../../workspace/workspace.js';
import { fetchAll } from './fileops.js';
import { triggerTrackUpdate } from './runner.js';
import { isTrackScheduleDue } from './schedule-utils.js';

const log = new PrefixLogger('TrackScheduler');
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

async function processScheduledTracks(): Promise<void> {
    const relativePaths = await listKnowledgeMarkdownFiles();
    log.log(`Scanning ${relativePaths.length} markdown files`);

    for (const relativePath of relativePaths) {
        let tracks;
        try {
            tracks = await fetchAll(relativePath);
        } catch {
            continue;
        }

        for (const trackState of tracks) {
            const { track } = trackState;
            if (!track.active) continue;
            if (!track.schedule) continue;

            const due = isTrackScheduleDue(track.schedule, track.lastRunAt ?? null);
            log.log(`Track "${track.trackId}" in ${relativePath}: schedule=${track.schedule.type}, lastRunAt=${track.lastRunAt ?? 'never'}, due=${due}`);

            if (due) {
                log.log(`Triggering "${track.trackId}" in ${relativePath}`);
                triggerTrackUpdate(track.trackId, relativePath, undefined, 'timed').catch(err => {
                    log.log(`Error running ${track.trackId}:`, err);
                });
            }
        }
    }
}

export async function init(): Promise<void> {
    log.log(`Starting, polling every ${POLL_INTERVAL_MS / 1000}s`);

    // Initial run
    await processScheduledTracks();

    // Periodic polling
    while (true) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
            await processScheduledTracks();
        } catch (error) {
            log.log('Error in main loop:', error);
        }
    }
}
