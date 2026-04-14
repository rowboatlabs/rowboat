import fs from 'fs';
import path from 'path';
import { PrefixLogger, trackBlock } from '@x/shared';
import type { KnowledgeEvent } from '@x/shared/dist/track-block.js';
import { WorkDir } from '../../config/config.js';
import * as workspace from '../../workspace/workspace.js';
import { fetchAll } from './fileops.js';
import { triggerTrackUpdate } from './runner.js';
import { findCandidates, type ParsedTrack } from './routing.js';
import type { IMonotonicallyIncreasingIdGenerator } from '../../application/lib/id-gen.js';
import container from '../../di/container.js';

const POLL_INTERVAL_MS = 5_000; // 5 seconds — events should feel responsive
const EVENTS_DIR = path.join(WorkDir, 'events');
const PENDING_DIR = path.join(EVENTS_DIR, 'pending');
const DONE_DIR = path.join(EVENTS_DIR, 'done');

const log = new PrefixLogger('EventProcessor');

/**
 * Write a KnowledgeEvent to the events/pending/ directory.
 * Filename is a monotonically increasing ID so events sort by creation order.
 * Call this function in chronological order (oldest event first) within a sync batch
 * to ensure correct ordering.
 */
export async function createEvent(event: Omit<KnowledgeEvent, 'id'>): Promise<void> {
    fs.mkdirSync(PENDING_DIR, { recursive: true });

    const idGen = container.resolve<IMonotonicallyIncreasingIdGenerator>('idGenerator');
    const id = await idGen.next();

    const fullEvent: KnowledgeEvent = { id, ...event };
    const filePath = path.join(PENDING_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullEvent, null, 2), 'utf-8');
}

function ensureDirs(): void {
    fs.mkdirSync(PENDING_DIR, { recursive: true });
    fs.mkdirSync(DONE_DIR, { recursive: true });
}

async function listAllTracks(): Promise<ParsedTrack[]> {
    const tracks: ParsedTrack[] = [];
    let entries;
    try {
        entries = await workspace.readdir('knowledge', { recursive: true });
    } catch {
        return tracks;
    }
    const mdFiles = entries
        .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
        .map(e => e.path.replace(/^knowledge\//, ''));

    for (const filePath of mdFiles) {
        let parsedTracks;
        try {
            parsedTracks = await fetchAll(filePath);
        } catch {
            continue;
        }
        for (const t of parsedTracks) {
            tracks.push({
                trackId: t.track.trackId,
                filePath,
                eventMatchCriteria: t.track.eventMatchCriteria ?? '',
                instruction: t.track.instruction,
                active: t.track.active,
            });
        }
    }
    return tracks;
}

function moveEventToDone(filename: string, enriched: KnowledgeEvent): void {
    const donePath = path.join(DONE_DIR, filename);
    const pendingPath = path.join(PENDING_DIR, filename);
    fs.writeFileSync(donePath, JSON.stringify(enriched, null, 2), 'utf-8');
    try {
        fs.unlinkSync(pendingPath);
    } catch (err) {
        log.log(`Failed to remove pending event ${filename}:`, err);
    }
}

async function processOneEvent(filename: string): Promise<void> {
    const pendingPath = path.join(PENDING_DIR, filename);

    let event: KnowledgeEvent;
    try {
        const raw = fs.readFileSync(pendingPath, 'utf-8');
        const parsed = JSON.parse(raw);
        event = trackBlock.KnowledgeEventSchema.parse(parsed);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.log(`Malformed event ${filename}, moving to done with error:`, msg);
        const stub: KnowledgeEvent = {
            id: filename.replace(/\.json$/, ''),
            source: 'unknown',
            type: 'unknown',
            createdAt: new Date().toISOString(),
            payload: '',
            processedAt: new Date().toISOString(),
            error: `Failed to parse: ${msg}`,
        };
        moveEventToDone(filename, stub);
        return;
    }

    log.log(`Processing event ${event.id} (source=${event.source}, type=${event.type})`);

    const allTracks = await listAllTracks();
    const candidates = await findCandidates(event, allTracks);

    const runIds: string[] = [];
    let processingError: string | undefined;

    // Sequential — preserves total ordering
    for (const candidate of candidates) {
        try {
            const result = await triggerTrackUpdate(
                candidate.trackId,
                candidate.filePath,
                event.payload,
                'event',
            );
            if (result.runId) runIds.push(result.runId);
            log.log(`Candidate ${candidate.trackId}: ${result.action}${result.error ? ` (${result.error})` : ''}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.log(`Error triggering candidate ${candidate.trackId}:`, msg);
            processingError = (processingError ? processingError + '; ' : '') + `${candidate.trackId}: ${msg}`;
        }
    }

    const enriched: KnowledgeEvent = {
        ...event,
        processedAt: new Date().toISOString(),
        candidates: candidates.map(c => ({ trackId: c.trackId, filePath: c.filePath })),
        runIds,
        ...(processingError ? { error: processingError } : {}),
    };

    moveEventToDone(filename, enriched);
}

async function processPendingEvents(): Promise<void> {
    ensureDirs();

    let filenames: string[];
    try {
        filenames = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json'));
    } catch (err) {
        log.log('Failed to read pending dir:', err);
        return;
    }

    if (filenames.length === 0) return;

    // FIFO: monotonic IDs are lexicographically sortable
    filenames.sort();

    log.log(`Processing ${filenames.length} pending event(s)`);

    for (const filename of filenames) {
        try {
            await processOneEvent(filename);
        } catch (err) {
            log.log(`Unhandled error processing ${filename}:`, err);
            // Keep the loop alive — don't move file, will retry on next tick
        }
    }
}

export async function init(): Promise<void> {
    log.log(`Starting, polling every ${POLL_INTERVAL_MS / 1000}s`);
    ensureDirs();

    // Initial run
    await processPendingEvents();

    while (true) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
            await processPendingEvents();
        } catch (err) {
            log.log('Error in main loop:', err);
        }
    }
}
