import z from 'zod';
import { useSyncExternalStore } from 'react';
import { BackgroundTaskAgentEvent } from '@x/shared/dist/background-task.js';

export type BackgroundTaskAgentStatus = 'idle' | 'running' | 'done' | 'error';

export interface BackgroundTaskAgentState {
    status: BackgroundTaskAgentStatus;
    runId?: string;
    summary?: string | null;
    error?: string | null;
}

// Module-level store — shared across all hook consumers, subscribed once.
// We replace the Map on every mutation so useSyncExternalStore detects the change.
let store = new Map<string, BackgroundTaskAgentState>();
const listeners = new Set<() => void>();
let subscribed = false;

function updateStore(fn: (prev: Map<string, BackgroundTaskAgentState>) => void) {
    store = new Map(store);
    fn(store);
    for (const listener of listeners) listener();
}

function ensureSubscription() {
    if (subscribed) return;
    subscribed = true;
    window.ipc.on('bg-task-agent:events', ((event: z.infer<typeof BackgroundTaskAgentEvent>) => {
        const key = event.slug;

        if (event.type === 'background_task_agent_start') {
            updateStore(s => s.set(key, { status: 'running', runId: event.runId }));
        } else if (event.type === 'background_task_agent_complete') {
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
    }) as (event: z.infer<typeof BackgroundTaskAgentEvent>) => void);
}

function subscribe(onStoreChange: () => void): () => void {
    ensureSubscription();
    listeners.add(onStoreChange);
    return () => { listeners.delete(onStoreChange); };
}

function getSnapshot(): Map<string, BackgroundTaskAgentState> {
    return store;
}

/**
 * Returns a Map of all bg-task agent run states, keyed by `slug`.
 *
 * Usage in the detail view:
 *   const status = useBackgroundTaskAgentStatus();
 *   const state = status.get(slug) ?? { status: 'idle' };
 *
 * Usage for a global indicator:
 *   const status = useBackgroundTaskAgentStatus();
 *   const anyRunning = [...status.values()].some(s => s.status === 'running');
 */
export function useBackgroundTaskAgentStatus(): Map<string, BackgroundTaskAgentState> {
    return useSyncExternalStore(subscribe, getSnapshot);
}
