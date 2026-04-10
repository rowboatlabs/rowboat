import fs from 'fs';
import path from 'path';
import { PrefixLogger } from '@x/shared';
import { WorkDir } from '../../config/config.js';
import { fetchAll } from './fileops.js';
import { triggerTrackUpdate } from './runner.js';
import { isTrackScheduleDue } from './schedule-utils.js';

const log = new PrefixLogger('TrackScheduler');
const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const POLL_INTERVAL_MS = 15_000; // 15 seconds

function scanMarkdownFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...scanMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
        }
    }
    return files;
}

async function processScheduledTracks(): Promise<void> {
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        log.log('Knowledge directory not found');
        return;
    }

    const allFiles = scanMarkdownFiles(KNOWLEDGE_DIR);
    log.log(`Scanning ${allFiles.length} markdown files`);

    for (const fullPath of allFiles) {
        const relativePath = path.relative(KNOWLEDGE_DIR, fullPath);

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
