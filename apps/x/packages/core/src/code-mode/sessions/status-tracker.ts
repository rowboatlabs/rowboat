import z from 'zod';
import { RunEvent } from '@x/shared/dist/runs.js';
import type { IBus } from '../../application/lib/bus.js';
import type { ICodeSessionsRepo } from './repo.js';
import type { INotificationService } from '../../application/notification/service.js';
import type { CodeSessionStatus, CodeSession } from '@x/shared/dist/code-sessions.js';
import container from '../../di/container.js';

export type StatusListener = (sessionId: string, status: CodeSessionStatus) => void;

// Authoritative live status for Code-section sessions, derived in the main
// process from the run event stream. Works for both modes uniformly because
// direct turns and Rowboat-mode code_agent_run turns publish the same event
// types on the bus. The renderer just renders what this pushes.
export class CodeSessionStatusTracker {
    private readonly bus: IBus;
    private readonly codeSessionsRepo: ICodeSessionsRepo;
    private readonly statuses = new Map<string, CodeSessionStatus>();
    private readonly busySince = new Map<string, number>();
    private readonly listeners = new Set<StatusListener>();
    private unsubscribe: (() => void) | null = null;
    // Session ids known to be code sessions; refreshed lazily on unknown ids so
    // sessions created after start() are picked up without explicit wiring.
    private knownSessions = new Set<string>();
    // Ids confirmed NOT to be sessions (regular chat runs). Safe to cache
    // permanently: a session's meta file is written before its first turn, so
    // an id that misses the refresh can never become a session later.
    private readonly knownNonSessions = new Set<string>();

    constructor({ bus, codeSessionsRepo }: { bus: IBus; codeSessionsRepo: ICodeSessionsRepo }) {
        this.bus = bus;
        this.codeSessionsRepo = codeSessionsRepo;
    }

    async start(): Promise<void> {
        if (this.unsubscribe) return;
        await this.refreshKnownSessions();
        this.unsubscribe = await this.bus.subscribe('*', async (event) => {
            await this.handle(event);
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    onTransition(listener: StatusListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getStatuses(): Record<string, CodeSessionStatus> {
        return Object.fromEntries(this.statuses);
    }

    private async refreshKnownSessions(): Promise<void> {
        const sessions = await this.codeSessionsRepo.list().catch(() => [] as CodeSession[]);
        this.knownSessions = new Set(sessions.map((s) => s.id));
    }

    private async isCodeSession(runId: string): Promise<boolean> {
        if (this.knownSessions.has(runId)) return true;
        if (this.knownNonSessions.has(runId)) return false;
        // Unknown id — maybe a session created since the last refresh.
        await this.refreshKnownSessions();
        if (this.knownSessions.has(runId)) return true;
        this.knownNonSessions.add(runId);
        return false;
    }

    private async handle(event: z.infer<typeof RunEvent>): Promise<void> {
        const relevant = event.type === 'run-processing-start'
            || event.type === 'run-processing-end'
            || event.type === 'run-stopped'
            || event.type === 'error'
            || event.type === 'code-run-permission-request'
            || (event.type === 'code-run-event' && event.event.type === 'permission');
        if (!relevant) return;
        if (!await this.isCodeSession(event.runId)) return;

        const previous = this.statuses.get(event.runId) ?? 'idle';
        let next: CodeSessionStatus = previous;
        switch (event.type) {
            case 'run-processing-start':
                next = 'working';
                break;
            case 'code-run-permission-request':
                next = 'needs-you';
                break;
            case 'code-run-event':
                // A permission resolution while the turn is still running.
                if (previous === 'needs-you') next = 'working';
                break;
            case 'run-processing-end':
            case 'run-stopped':
            case 'error':
                next = 'idle';
                break;
        }
        if (next === previous) return;
        if (previous === 'idle' && next !== 'idle') this.busySince.set(event.runId, Date.now());
        this.statuses.set(event.runId, next);
        for (const listener of this.listeners) listener(event.runId, next);
        await this.notify(event.runId, previous, next);
        if (next === 'idle') this.busySince.delete(event.runId);
    }

    private async notify(sessionId: string, previous: CodeSessionStatus, next: CodeSessionStatus): Promise<void> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (session?.suppressNotifications) return;

        let notificationService: INotificationService;
        try {
            notificationService = container.resolve<INotificationService>('notificationService');
        } catch {
            return; // not registered (e.g. tests)
        }
        if (!notificationService.isSupported()) return;
        const title = session?.title ?? 'Coding session';
        if (next === 'needs-you') {
            notificationService.notify({
                title,
                message: 'The coding agent needs your approval.',
            });
        } else if (next === 'idle' && previous === 'working') {
            // Only worth interrupting for if the agent worked long enough that
            // the user has plausibly moved on to something else.
            const since = this.busySince.get(sessionId);
            if (since !== undefined && Date.now() - since > 30_000) {
                notificationService.notify({
                    title,
                    message: 'The coding agent finished its turn.',
                });
            }
        }
    }
}
