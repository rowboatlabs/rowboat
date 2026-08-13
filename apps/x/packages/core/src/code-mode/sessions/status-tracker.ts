import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { ITurnEventBus } from '../../runtime/turns/event-hub.js';
import type { ICodeSessionsRepo } from './repo.js';
import { notifyIfEnabled } from '../../application/notification/notifier.js';
import type { CodeSessionStatus, CodeSession } from '@x/shared/dist/code-sessions.js';

export type StatusListener = (sessionId: string, status: CodeSessionStatus) => void;

// Authoritative live status for Code-section sessions, derived in the main
// process from the turn event spine (a code session IS a chat session, so its
// turns flow there like any other chat's). The renderer just renders what
// this pushes.
export class CodeSessionStatusTracker {
    private readonly turnEventBus: ITurnEventBus;
    private readonly codeSessionsRepo: ICodeSessionsRepo;
    private readonly statuses = new Map<string, CodeSessionStatus>();
    private readonly busySince = new Map<string, number>();
    private readonly listeners = new Set<StatusListener>();
    private unsubscribe: (() => void) | null = null;
    // Session ids known to be code sessions; refreshed lazily on unknown ids so
    // sessions created after start() are picked up without explicit wiring.
    private knownSessions = new Set<string>();
    // Ids confirmed NOT to be code sessions (regular chats). Mostly stable —
    // but adoption (CodeSessionService.createForSession) is the one path
    // where a plain chat BECOMES a code session mid-life, so the service
    // clears the verdict via noteCodeSession() when it writes meta.
    private readonly knownNonSessions = new Set<string>();

    constructor({ turnEventBus, codeSessionsRepo }: { turnEventBus: ITurnEventBus; codeSessionsRepo: ICodeSessionsRepo }) {
        this.turnEventBus = turnEventBus;
        this.codeSessionsRepo = codeSessionsRepo;
    }

    // Events are processed strictly in arrival order: handle() awaits repo
    // lookups, and the spine delivers synchronously — without this chain two
    // events could interleave and apply their transitions out of order
    // (e.g. a terminal event finishing before the turn_created that preceded
    // it, leaving a session spinning forever).
    private queue: Promise<void> = Promise.resolve();

    async start(): Promise<void> {
        if (this.unsubscribe) return;
        await this.refreshKnownSessions();
        this.unsubscribe = this.turnEventBus.subscribeAll((event) => {
            this.queue = this.queue
                .then(() => this.handle(event))
                .catch(() => { /* status is best-effort; never break the chain */ });
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

    /** An existing chat was adopted as a code session (meta written after
     * its first turns) — un-cache the "not a code session" verdict so its
     * events start counting. */
    noteCodeSession(sessionId: string): void {
        this.knownSessions.add(sessionId);
        this.knownNonSessions.delete(sessionId);
    }

    private async refreshKnownSessions(): Promise<void> {
        const sessions = await this.codeSessionsRepo.list().catch(() => [] as CodeSession[]);
        this.knownSessions = new Set(sessions.map((s) => s.id));
    }

    private async isCodeSession(sessionId: string): Promise<boolean> {
        if (this.knownSessions.has(sessionId)) return true;
        if (this.knownNonSessions.has(sessionId)) return false;
        // Unknown id — maybe a session created since the last refresh.
        await this.refreshKnownSessions();
        if (this.knownSessions.has(sessionId)) return true;
        this.knownNonSessions.add(sessionId);
        return false;
    }

    // What a spine event means for a code session's status. Returns null for
    // events that don't move the needle (deltas, tool results, ...).
    private transition(event: TurnBusEvent, previous: CodeSessionStatus): CodeSessionStatus | null {
        const e = event.event;
        switch (e.type) {
            case 'turn_created':
                return 'working';
            // The copilot's own permission gate, and the coding agent's inline
            // approval card (durable tool_progress) both need the user.
            case 'tool_permission_required':
            case 'turn_suspended':
                return 'needs-you';
            case 'tool_permission_resolved':
                return previous === 'needs-you' ? 'working' : null;
            // An answered ask-human arrives as an async tool_result (there is
            // no *_resolved event for it) — without this the badge said
            // "needs your attention" forever after the user replied, and the
            // completion notification never fired.
            case 'tool_result':
                return previous === 'needs-you' ? 'working' : null;
            case 'tool_progress': {
                const progress = e.progress;
                if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
                    const kind = (progress as { kind?: unknown }).kind;
                    if (kind === 'code-run-permission-request') return 'needs-you';
                    if (kind === 'code-run-permission-resolved') return previous === 'needs-you' ? 'working' : null;
                }
                return null;
            }
            case 'turn_completed':
            case 'turn_failed':
            case 'turn_cancelled':
                return 'idle';
            default:
                return null;
        }
    }

    private async handle(event: TurnBusEvent): Promise<void> {
        const sessionId = event.sessionId;
        if (!sessionId) return;
        const previous = this.statuses.get(sessionId) ?? 'idle';
        const next = this.transition(event, previous);
        if (next === null || next === previous) return;
        if (!await this.isCodeSession(sessionId)) return;

        if (previous === 'idle' && next !== 'idle') {
            this.busySince.set(sessionId, Date.now());
            // Activity bump for the session rail's recency sort (best-effort).
            void this.touchMeta(sessionId);
        }
        this.statuses.set(sessionId, next);
        for (const listener of this.listeners) listener(sessionId, next);
        await this.notify(sessionId, previous, next);
        if (next === 'idle') this.busySince.delete(sessionId);
    }

    private async touchMeta(sessionId: string): Promise<void> {
        try {
            const session = await this.codeSessionsRepo.get(sessionId);
            if (!session) return;
            await this.codeSessionsRepo.save({ ...session, lastActivityAt: new Date().toISOString() });
        } catch {
            // Recency sort just stays where it was.
        }
    }

    private async notify(sessionId: string, previous: CodeSessionStatus, next: CodeSessionStatus): Promise<void> {
        // Route through notifyIfEnabled so the user's notification-category
        // toggles are honoured — a coding agent asking for approval maps to
        // `agent_permission`, and one finishing its turn maps to
        // `chat_completion`. notifyIfEnabled also resolves the service, checks
        // platform support, and swallows errors, so a disabled toggle, missing
        // service (e.g. tests), or unsupported platform all no-op safely.
        const session = await this.codeSessionsRepo.get(sessionId);
        const title = session?.title ?? 'Coding session';
        if (next === 'needs-you') {
            await notifyIfEnabled('agent_permission', {
                title,
                message: 'The coding agent needs your approval.',
            });
        } else if (next === 'idle' && previous === 'working') {
            // Only worth interrupting for if the agent worked long enough that
            // the user has plausibly moved on to something else.
            const since = this.busySince.get(sessionId);
            if (since !== undefined && Date.now() - since > 30_000) {
                await notifyIfEnabled('chat_completion', {
                    title,
                    message: 'The coding agent finished its turn.',
                    // The category's own contract ("while the app is in the
                    // background") — the session row already shows the settle.
                    onlyWhenBackground: true,
                });
            }
        }
    }
}
