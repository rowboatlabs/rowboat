import type { PendingApproval } from '@x/shared/dist/approvals.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { bus } from '../runs/bus.js';
import { backgroundTaskBus } from './bus.js';
import { fetchTask } from './fileops.js';

const log = new PrefixLogger('BgTask:Approvals');

// Pending permission asks from headless background-task runs, waiting on the
// user. In-memory only — consistent with the rest of the run lifecycle (the
// runner's waitForRunCompletion and the code permission registry are both
// in-memory): an app restart abandons in-flight runs, so their asks die too.
// Renderer reloads are covered by the `approvals:list` snapshot invoke.

interface TrackedRun {
    slug: string;
    taskName: string;
    items: PendingApproval[];
}

type Listener = (approvals: PendingApproval[]) => void;

const trackedRuns = new Map<string, TrackedRun>();
const listeners: Listener[] = [];
let initialized = false;

export function getPendingApprovals(): PendingApproval[] {
    const all: PendingApproval[] = [];
    for (const run of trackedRuns.values()) {
        all.push(...run.items);
    }
    return all.sort((a, b) => a.ts.localeCompare(b.ts));
}

export function subscribePendingApprovals(cb: Listener): () => void {
    listeners.push(cb);
    return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
    };
}

function notify(): void {
    const snapshot = getPendingApprovals();
    for (const cb of listeners) {
        cb(snapshot);
    }
}

/**
 * Start tracking pending approvals. Subscribes to the backgroundTaskBus for
 * runId→slug mapping (the start event fires before the agent's first message,
 * so the mapping always precedes any permission event) and to the run-event
 * bus for permission requests/resolutions.
 */
export function initBackgroundApprovals(): void {
    if (initialized) return;
    initialized = true;

    backgroundTaskBus.subscribe((event) => {
        if (event.type === 'background_task_agent_start') {
            trackedRuns.set(event.runId, { slug: event.slug, taskName: event.slug, items: [] });
            void fetchTask(event.slug).then((task) => {
                const tracked = trackedRuns.get(event.runId);
                if (tracked && task?.name) {
                    tracked.taskName = task.name;
                }
            });
        } else if (event.type === 'background_task_agent_complete') {
            const tracked = trackedRuns.get(event.runId);
            trackedRuns.delete(event.runId);
            if (tracked && tracked.items.length > 0) notify();
        }
    });

    void bus.subscribe('*', async (event) => {
        const tracked = trackedRuns.get(event.runId);
        if (!tracked) return;

        switch (event.type) {
            case 'tool-permission-request':
                tracked.items.push({
                    kind: 'tool',
                    runId: event.runId,
                    slug: tracked.slug,
                    taskName: tracked.taskName,
                    toolCallId: event.toolCall.toolCallId,
                    subflow: event.subflow,
                    toolCall: event.toolCall,
                    permission: event.permission,
                    ts: event.ts ?? new Date().toISOString(),
                });
                log.log(`${tracked.slug} — pending tool ask: ${event.toolCall.toolName}`);
                notify();
                break;
            case 'tool-permission-response': {
                const before = tracked.items.length;
                tracked.items = tracked.items.filter(
                    (item) => !(item.kind === 'tool' && item.toolCallId === event.toolCallId),
                );
                if (tracked.items.length !== before) notify();
                break;
            }
            case 'code-run-permission-request':
                tracked.items.push({
                    kind: 'code',
                    runId: event.runId,
                    slug: tracked.slug,
                    taskName: tracked.taskName,
                    requestId: event.requestId,
                    toolCallId: event.toolCallId,
                    ask: event.ask,
                    ts: event.ts ?? new Date().toISOString(),
                });
                log.log(`${tracked.slug} — pending code ask: ${event.ask.title}`);
                notify();
                break;
            case 'code-run-event': {
                // The resolution event carries no requestId — remove the oldest
                // code item for this run (asks block the coding turn, so there
                // is at most one pending in practice).
                if (event.event.type !== 'permission') break;
                const idx = tracked.items.findIndex((item) => item.kind === 'code');
                if (idx >= 0) {
                    tracked.items.splice(idx, 1);
                    notify();
                }
                break;
            }
            case 'run-stopped':
            case 'error':
                if (tracked.items.length > 0) {
                    tracked.items = [];
                    notify();
                }
                break;
        }
    });
}
