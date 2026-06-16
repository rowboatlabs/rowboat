import { useMemo, useSyncExternalStore } from 'react';
import type { PendingApproval } from '@x/shared/dist/approvals.js';

// Module-level store — shared across all hook consumers, subscribed once.
// Main pushes a full snapshot on every change ('approvals:events'); the
// initial state is fetched once via 'approvals:list' so a renderer reload
// doesn't lose asks that fired before the page loaded.
let store: PendingApproval[] = [];
const listeners = new Set<() => void>();
let subscribed = false;

function setStore(approvals: PendingApproval[]) {
    store = approvals;
    for (const listener of listeners) listener();
}

function ensureSubscription() {
    if (subscribed) return;
    subscribed = true;
    window.ipc.on('approvals:events', (event) => {
        setStore(event.approvals);
    });
    void window.ipc.invoke('approvals:list', null).then((res) => {
        setStore(res.approvals);
    }).catch(() => {
        // main not ready yet — the next approvals:events push corrects us
    });
}

function subscribe(onStoreChange: () => void): () => void {
    ensureSubscription();
    listeners.add(onStoreChange);
    return () => { listeners.delete(onStoreChange); };
}

function getSnapshot(): PendingApproval[] {
    return store;
}

/** Optimistically drop an approval the user just answered; the next snapshot
 * from main is authoritative either way. */
export function dismissApprovalOptimistic(approval: PendingApproval) {
    setStore(store.filter((a) => a !== approval));
}

/** All background-run permission asks currently waiting on the user. */
export function usePendingApprovals(): PendingApproval[] {
    return useSyncExternalStore(subscribe, getSnapshot);
}

/** Slugs of background tasks with at least one ask waiting on the user. */
export function useWaitingTaskSlugs(): Set<string> {
    const approvals = usePendingApprovals();
    return useMemo(() => new Set(approvals.map((a) => a.slug)), [approvals]);
}
