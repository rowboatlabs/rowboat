import fs from 'fs';
import path from 'path';
import { events, PrefixLogger } from '@x/shared';
import type { RowboatEvent, ConsumerResult } from '@x/shared/dist/events.js';
import type { EventConsumer } from './consumer.js';
import { PENDING_DIR, DONE_DIR, ensureEventDirs } from './producer.js';

const log = new PrefixLogger('Events:Processor');

let registeredConsumers: EventConsumer[] = [];

export function registerConsumer(consumer: EventConsumer): void {
    registeredConsumers.push(consumer);
    log.log(`registered consumer: ${consumer.name}`);
}

/** @internal — for tests. */
export function _resetConsumersForTests(): void {
    registeredConsumers = [];
}

function moveEventToDone(filename: string, enriched: RowboatEvent): void {
    const donePath = path.join(DONE_DIR, filename);
    const pendingPath = path.join(PENDING_DIR, filename);
    fs.writeFileSync(donePath, JSON.stringify(enriched, null, 2), 'utf-8');
    try {
        fs.unlinkSync(pendingPath);
    } catch (err) {
        log.log(`failed to remove pending event ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Materialize the legacy `targetFilePath` field — events written by the
 * pre-rename code carry the flat field; the new processor reads it as a
 * live-note targeted re-run.
 */
function migrateLegacyTarget(event: RowboatEvent): RowboatEvent {
    if (event.target || !event.targetFilePath) return event;
    return { ...event, target: { consumer: 'live-note', id: event.targetFilePath } };
}

async function processOneEvent(filename: string): Promise<void> {
    const pendingPath = path.join(PENDING_DIR, filename);

    let event: RowboatEvent;
    try {
        const raw = fs.readFileSync(pendingPath, 'utf-8');
        const parsed = JSON.parse(raw);
        event = events.RowboatEventSchema.parse(parsed);
        event = migrateLegacyTarget(event);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.log(`event:${filename} — malformed, moving to done with error: ${msg}`);
        const stub: RowboatEvent = {
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

    log.log(`event:${event.id} — received source=${event.source} type=${event.type}`);

    if (registeredConsumers.length === 0) {
        // No consumers — drop with a note in `done/` so the dir doesn't fill.
        const enriched: RowboatEvent = {
            ...event,
            processedAt: new Date().toISOString(),
            consumers: {},
        };
        moveEventToDone(filename, enriched);
        return;
    }

    // Pass-1: run all consumers' routing concurrently. Each consumer is
    // responsible for short-circuiting when `event.target?.consumer === this.name`.
    const passOne = await Promise.all(registeredConsumers.map(async (consumer) => {
        try {
            const targets = await consumer.listEligibleTargets();
            const candidateIds = await consumer.findCandidates(event, targets);
            return { consumer, candidateIds, error: undefined as string | undefined };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.log(`event:${event.id} — consumer ${consumer.name} Pass-1 threw: ${msg}`);
            return { consumer, candidateIds: [], error: msg };
        }
    }));

    // Firing: each consumer fires its candidates sequentially (preserves
    // per-target FIFO). Consumers run in parallel via Promise.all.
    const fired = await Promise.all(passOne.map(async ({ consumer, candidateIds, error }) => {
        const result: ConsumerResult = { candidateIds, runIds: [], errors: error ? [error] : [] };

        for (const id of candidateIds) {
            try {
                const r = await consumer.fireCandidate(event, id);
                if (r.runId) result.runIds.push(r.runId);
                if (r.error) {
                    result.errors!.push(`${id}: ${r.error}`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                log.log(`event:${event.id} — consumer ${consumer.name} candidate ${id} threw: ${msg}`);
                result.errors!.push(`${id}: ${msg}`);
            }
        }

        if (result.errors!.length === 0) {
            delete result.errors;
        }

        const total = candidateIds.length;
        if (total > 0) {
            const errCount = result.errors?.length ?? 0;
            const okCount = result.runIds.length;
            log.log(`event:${event.id} — ${consumer.name} processed ok=${okCount} errors=${errCount}`);
        }

        return { name: consumer.name, result };
    }));

    const consumersMap: Record<string, ConsumerResult> = {};
    for (const { name, result } of fired) {
        consumersMap[name] = result;
    }

    const enriched: RowboatEvent = {
        ...event,
        processedAt: new Date().toISOString(),
        consumers: consumersMap,
    };

    moveEventToDone(filename, enriched);
}

export async function processPendingEvents(): Promise<void> {
    ensureEventDirs();

    let filenames: string[];
    try {
        filenames = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json'));
    } catch (err) {
        log.log(`failed to read pending dir: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }

    if (filenames.length === 0) return;

    // FIFO: monotonic IDs are lexicographically sortable
    filenames.sort();

    if (filenames.length > 1) {
        log.log(`tick — ${filenames.length} pending events`);
    }

    for (const filename of filenames) {
        try {
            await processOneEvent(filename);
        } catch (err) {
            log.log(`event:${filename} — unhandled error: ${err instanceof Error ? err.message : String(err)}`);
            // Keep the loop alive — don't move file, will retry on next tick
        }
    }
}
