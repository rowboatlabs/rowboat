import z from 'zod';
import { useSyncExternalStore } from 'react';
import { TrackEvent } from '@x/shared/dist/track-block.js';

export type TrackRunStatus = 'idle' | 'running' | 'done' | 'error';

export interface TrackState {
    status: TrackRunStatus;
    runId?: string;
    summary?: string | null;
    error?: string | null;
}

// Module-level store — shared across all hook consumers, subscribed once
// We replace the Map on every mutation so useSyncExternalStore detects the change
let store = new Map<string, TrackState>();
const listeners = new Set<() => void>();
let subscribed = false;

function updateStore(fn: (prev: Map<string, TrackState>) => void) {
    store = new Map(store);
    fn(store);
    for (const listener of listeners) listener();
}

function ensureSubscription() {
    if (subscribed) return;
    subscribed = true;
    window.ipc.on('tracks:events', ((event: z.infer<typeof TrackEvent>) => {
        const key = `${event.trackId}:${event.filePath}`;

        if (event.type === 'track_run_start') {
            updateStore(s => s.set(key, { status: 'running', runId: event.runId }));
        } else if (event.type === 'track_run_complete') {
            updateStore(s => s.set(key, {
                status: event.error ? 'error' : 'done',
                runId: event.runId,
                summary: event.summary ?? null,
                error: event.error ?? null,
            }));
            // Auto-clear after 5 seconds
            setTimeout(() => {
                updateStore(s => s.delete(key));
            }, 5000);
        }
    }) as (event: z.infer<typeof TrackEvent>) => void);
}

function subscribe(onStoreChange: () => void): () => void {
    ensureSubscription();
    listeners.add(onStoreChange);
    return () => { listeners.delete(onStoreChange); };
}

function getSnapshot(): Map<string, TrackState> {
    return store;
}

/**
 * Returns a Map of all track run states, keyed by "trackId:filePath".
 *
 * Usage in a track block component:
 *   const trackStatus = useTrackStatus();
 *   const state = trackStatus.get(`${trackId}:${filePath}`) ?? { status: 'idle' };
 *
 * Usage for a global indicator:
 *   const trackStatus = useTrackStatus();
 *   const anyRunning = [...trackStatus.values()].some(s => s.status === 'running');
 */
export function useTrackStatus(): Map<string, TrackState> {
    return useSyncExternalStore(subscribe, getSnapshot);
}
