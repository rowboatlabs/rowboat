import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { HomeThread, HomeThreadStatus } from '@x/shared/dist/home-threads.js';
import type { TodoItem, TodoList } from '@x/shared/dist/todo.js';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import type { ITurnEventBus } from '../runtime/turns/event-hub.js';
import type { ISessions } from '../runtime/sessions/api.js';
// The concrete bus: ISessionBus is publish-only by design; subscribing is an
// app-layer affordance (same resolution pattern as main's sessions watcher).
import type { EmitterSessionBus } from '../runtime/sessions/bus.js';
import type { ICodeSessionsRepo } from '../code-mode/sessions/repo.js';
import type { ICodeProjectsRepo } from '../code-mode/projects/repo.js';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';
import { worktreeDiffstatLine } from '../code-mode/sessions/review.js';
import { readTodo } from '../todo/fileops.js';
import { getSessionIndex } from '../todo/session-index.js';
import { todoBus } from '../todo/bus.js';

// ---------------------------------------------------------------------------
// The Home thread registry — one main-process derivation of every thread of
// delegated work, seen through the attention lens the Deck renders: what is
// underway, what needs the user, what's idle. Generalizes the transition
// semantics of code-mode/sessions/status-tracker.ts to ALL sessions (the
// durable index has no "running" status by design — live state exists only
// on the turn event spine, so a spine subscriber is the only way to know).
//
// Composition sources, all read fresh per snapshot (cheap at Home's scale):
//   - sessions.listSessions()      — the index: title, updatedAt, statuses
//   - todo/sessions.json           — item key ↔ sessionId (kind: task)
//   - todo.md receipts             — unanswered questions = durable needs-you
//   - code-session meta            — kind: code, project/agent/branch context
//   - home/state.json              — seen marks + pins (workspace-durable,
//                                    NOT localStorage: notifications and the
//                                    companion read the same truth)
// ---------------------------------------------------------------------------

const STATE_PATH = path.join(WorkDir, 'home', 'state.json');
const PING_DEBOUNCE_MS = 250;

interface HomeState {
    seen: Record<string, string>;
    pins: string[];
    /** Snoozes: until = expiry, since = when snoozed (activity after `since`
     * trips the wire early). Stale entries are harmless — they stop matching
     * and get overwritten by the next snooze. */
    snoozed: Record<string, { until: string; since: string }>;
    /** Dismissals: "release this claim on my attention" — no expiry, only
     * the activity tripwire (the thread moving again returns it). The
     * ledger's receipts are untouched: this silences the bay, not the fact. */
    dismissed: Record<string, { since: string }>;
}

// The live status machine lives on neutral ground — runtime/turns — so the
// Deck registry and the code-session status tracker consume ONE transition
// table instead of drifting copies.
import { transitionLive, type LiveTurnState } from '../runtime/turns/live-status.js';

async function readState(): Promise<HomeState> {
    try {
        const raw = await fs.readFile(STATE_PATH, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const obj = parsed as { seen?: unknown; pins?: unknown; snoozed?: unknown; dismissed?: unknown };
            const snoozed: HomeState['snoozed'] = {};
            if (obj.snoozed && typeof obj.snoozed === 'object' && !Array.isArray(obj.snoozed)) {
                for (const [key, value] of Object.entries(obj.snoozed as Record<string, unknown>)) {
                    const v = value as { until?: unknown; since?: unknown } | null;
                    if (typeof v?.until === 'string' && typeof v?.since === 'string') {
                        snoozed[key] = { until: v.until, since: v.since };
                    }
                }
            }
            const dismissed: HomeState['dismissed'] = {};
            if (obj.dismissed && typeof obj.dismissed === 'object' && !Array.isArray(obj.dismissed)) {
                for (const [key, value] of Object.entries(obj.dismissed as Record<string, unknown>)) {
                    const v = value as { since?: unknown } | null;
                    if (typeof v?.since === 'string') {
                        dismissed[key] = { since: v.since };
                    }
                }
            }
            return {
                seen:
                    obj.seen && typeof obj.seen === 'object' && !Array.isArray(obj.seen)
                        ? Object.fromEntries(
                              Object.entries(obj.seen as Record<string, unknown>).filter(
                                  (e): e is [string, string] => typeof e[1] === 'string',
                              ),
                          )
                        : {},
                pins: Array.isArray(obj.pins) ? obj.pins.filter((p): p is string => typeof p === 'string') : [],
                snoozed,
                dismissed,
            };
        }
    } catch {
        // missing or corrupt — start fresh; seen/pins/snoozes/dismissals
        // are losable attention state, never work state.
    }
    return { seen: {}, pins: [], snoozed: {}, dismissed: {} };
}

async function writeState(mutate: (state: HomeState) => void): Promise<void> {
    await withFileLock(STATE_PATH, async () => {
        const state = await readState();
        mutate(state);
        const dir = path.dirname(STATE_PATH);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    });
}

/** Walk a todo list into a flat key → item map (children included). */
function itemsByKey(list: TodoList): Map<string, TodoItem> {
    const map = new Map<string, TodoItem>();
    for (const block of list.blocks) {
        if (block.kind !== 'item') continue;
        map.set(block.item.key, block.item);
        for (const child of block.item.children) map.set(child.key, child);
    }
    return map;
}

export class HomeThreadsTracker {
    private readonly turnEventBus: ITurnEventBus;
    private readonly sessions: ISessions;
    private readonly sessionBus: EmitterSessionBus;
    private readonly codeSessionsRepo: ICodeSessionsRepo;
    private readonly codeProjectsRepo: ICodeProjectsRepo;

    private readonly live = new Map<string, LiveTurnState>();
    // Review-debt lines ("+42 −18 across 5 files…") per code session — git
    // runs at most once per settle, never per snapshot. null = empty diff
    // (nothing to review); absent = not computed yet.
    private readonly reviewLines = new Map<string, string | null>();
    private readonly reviewPending = new Set<string>();
    private readonly listeners = new Set<() => void>();
    private readonly unsubscribes: Array<() => void> = [];
    private pingTimer: ReturnType<typeof setTimeout> | null = null;
    // One wake timer for the earliest snooze expiry — expiries emit no event,
    // so the registry wakes itself to resurface the thread on time.
    private snoozeWake: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;
    private started = false;

    constructor({
        turnEventBus,
        sessions,
        sessionBus,
        codeSessionsRepo,
        codeProjectsRepo,
    }: {
        turnEventBus: ITurnEventBus;
        sessions: ISessions;
        sessionBus: EmitterSessionBus;
        codeSessionsRepo: ICodeSessionsRepo;
        codeProjectsRepo: ICodeProjectsRepo;
    }) {
        this.turnEventBus = turnEventBus;
        this.sessions = sessions;
        this.sessionBus = sessionBus;
        this.codeSessionsRepo = codeSessionsRepo;
        this.codeProjectsRepo = codeProjectsRepo;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.unsubscribes.push(
            this.turnEventBus.subscribeAll((event) => this.handleTurnEvent(event)),
            // Title changes and deletions don't ride the turn spine.
            this.sessionBus.subscribe(() => this.ping()),
            // Receipt changes (question landed / answered) move needs-you.
            todoBus.subscribe(() => this.ping()),
        );
    }

    stop(): void {
        for (const unsubscribe of this.unsubscribes) unsubscribe();
        this.unsubscribes.length = 0;
        if (this.pingTimer) clearTimeout(this.pingTimer);
        this.pingTimer = null;
        if (this.snoozeWake) clearTimeout(this.snoozeWake.timer);
        this.snoozeWake = null;
        this.started = false;
    }

    private scheduleSnoozeWake(untilIso: string): void {
        const at = Date.parse(untilIso);
        if (!Number.isFinite(at) || at <= Date.now()) return;
        if (this.snoozeWake && this.snoozeWake.at <= at) return; // an earlier wake covers it
        if (this.snoozeWake) clearTimeout(this.snoozeWake.timer);
        this.snoozeWake = {
            at,
            timer: setTimeout(() => {
                this.snoozeWake = null;
                this.ping();
            }, Math.min(at - Date.now() + 250, 2_147_000_000)),
        };
    }

    /** Debounced change signal — consumers refetch the snapshot. */
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private ping(): void {
        if (this.pingTimer) return;
        this.pingTimer = setTimeout(() => {
            this.pingTimer = null;
            for (const listener of this.listeners) listener();
        }, PING_DEBOUNCE_MS);
    }

    private handleTurnEvent(event: TurnBusEvent): void {
        const sessionId = event.sessionId;
        if (!sessionId) return; // headless turns have no thread
        const next = transitionLive(this.live.get(sessionId), event.event);
        if (next === null) return;
        if (next === 'clear') {
            this.live.delete(sessionId);
            // A settled turn may have changed the diff — recompute lazily.
            this.reviewLines.delete(sessionId);
        } else {
            this.live.set(sessionId, next);
        }
        this.ping();
    }

    /** Cached review-debt line for a code session; kicks off one async git
     * computation when unknown and pings on arrival. undefined = computing. */
    private reviewLineFor(meta: CodeSession): string | null | undefined {
        if (this.reviewLines.has(meta.id)) return this.reviewLines.get(meta.id);
        if (!this.reviewPending.has(meta.id)) {
            this.reviewPending.add(meta.id);
            void worktreeDiffstatLine(meta)
                .then((line) => {
                    this.reviewLines.set(meta.id, line);
                    this.reviewPending.delete(meta.id);
                    this.ping();
                })
                .catch(() => this.reviewPending.delete(meta.id));
        }
        return undefined;
    }

    async markSeen(sessionId: string): Promise<void> {
        await writeState((state) => {
            state.seen[sessionId] = new Date().toISOString();
        });
        this.ping();
    }

    async setPinned(sessionId: string, pinned: boolean): Promise<void> {
        await writeState((state) => {
            const set = new Set(state.pins);
            if (pinned) set.add(sessionId);
            else set.delete(sessionId);
            state.pins = [...set];
        });
        this.ping();
    }

    /** Dismiss a thread's claim on the user's attention: out of the bay,
     * the counts, and the sitrep — with no timer. Only the activity
     * tripwire returns it (the thread moving again earns its way back).
     * The ledger's receipts are untouched. */
    async dismiss(sessionId: string): Promise<void> {
        await writeState((state) => {
            state.dismissed[sessionId] = { since: new Date().toISOString() };
        });
        this.ping();
    }

    /** Snooze a thread out of the needs-you bay: back at `hours` from now,
     * or the moment the session sees new activity — whichever comes first. */
    async snooze(sessionId: string, hours = 4): Promise<void> {
        const now = new Date();
        const until = new Date(now.getTime() + hours * 3_600_000);
        await writeState((state) => {
            state.snoozed[sessionId] = { until: until.toISOString(), since: now.toISOString() };
        });
        this.scheduleSnoozeWake(until.toISOString());
        this.ping();
    }

    async snapshot(): Promise<HomeThread[]> {
        const entries = this.sessions.listSessions();
        const [todoIndex, todoList, codeMetas, projects, state] = await Promise.all([
            getSessionIndex().catch(() => ({}) as Record<string, string>),
            readTodo().catch(() => ({ blocks: [] }) as TodoList),
            this.codeSessionsRepo.list().catch(() => []),
            this.codeProjectsRepo.list().catch(() => []),
            readState(),
        ]);
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));
        const keyBySession = new Map(Object.entries(todoIndex).map(([key, sid]) => [sid, key]));
        const items = itemsByKey(todoList);
        const codeById = new Map(codeMetas.map((meta) => [meta.id, meta]));
        const pins = new Set(state.pins);
        // Slot = position in the pin ORDER, so 1–9 recall never reshuffles.
        const pinIndexById = new Map(state.pins.map((id, i) => [id, i]));
        const now = new Date().toISOString();

        const threads: HomeThread[] = [];
        for (const entry of entries) {
            // Empty shells (created, never used) aren't threads yet.
            if (entry.turnCount === 0 && !entry.title && !codeById.has(entry.sessionId)) continue;

            const todoKey = keyBySession.get(entry.sessionId);
            const item = todoKey ? items.get(todoKey) : undefined;
            const code = codeById.get(entry.sessionId);
            const live = this.live.get(entry.sessionId);
            // Finished work stays out of the deck; a live turn on it means
            // it is being reopened (the tracker clears the flag as it runs).
            if (code?.doneAt && !live) continue;

            let status: HomeThreadStatus;
            let attention: string | undefined;
            if (live) {
                status = live.status;
                attention = live.attention;
            } else if (entry.latestTurnStatus === 'suspended') {
                status = 'needs-you';
                attention = 'waiting on you — open the chat';
            } else {
                status = 'idle';
            }
            // Durable needs-you: an unanswered question receipt on an open
            // item (the live suspension may be long gone after a restart).
            if (status === 'idle' && item && !item.checked) {
                const last = item.receipts[item.receipts.length - 1];
                if (last?.kind === 'question') {
                    status = 'needs-you';
                    attention = last.text;
                }
            }
            // Review debt: a code thread whose worktree carries an actual
            // unmerged diff after a completed turn awaits the user's review
            // — it stays in the needs-you bay until merged or cleaned up.
            // An empty diff never nags (the git accounting is cached per
            // settle, see reviewLineFor).
            if (
                status === 'idle' &&
                code?.worktree &&
                !code.worktree.mergedAt &&
                !code.worktree.removedAt &&
                entry.latestTurnStatus === 'completed'
            ) {
                const line = this.reviewLineFor(code);
                if (line) {
                    status = 'ready';
                    attention = `ready for review — ${line}`;
                }
            }

            // The tripwire: a live snooze suppresses the needs-you bay until
            // its time passes OR the session moves again — whichever first.
            const snoozeEntry = state.snoozed[entry.sessionId];
            const snoozed = !!snoozeEntry && now < snoozeEntry.until && entry.updatedAt <= snoozeEntry.since;
            // Boot-persisted snoozes need their wake re-armed.
            if (snoozed) this.scheduleSnoozeWake(snoozeEntry.until);
            // Dismissal: same tripwire, no timer — only new activity on the
            // thread returns its claim.
            const dismissEntry = state.dismissed[entry.sessionId];
            const dismissed = !!dismissEntry && entry.updatedAt <= dismissEntry.since;

            const seenAt = state.seen[entry.sessionId];
            const pinIndex = pinIndexById.get(entry.sessionId);
            threads.push({
                sessionId: entry.sessionId,
                kind: code ? 'code' : todoKey ? 'task' : 'chat',
                status,
                title: item?.text ?? entry.title ?? code?.title ?? 'Untitled',
                attention,
                activity: live?.activity,
                todoKey,
                ...(pinIndex !== undefined ? { pinIndex } : {}),
                ...(snoozed ? { snoozed } : {}),
                ...(dismissed ? { dismissed } : {}),
                code: code
                    ? {
                          projectId: code.projectId,
                          projectName: projectNames.get(code.projectId) ?? code.projectId,
                          agent: code.agent,
                          branch: code.worktree?.branch,
                      }
                    : undefined,
                updatedAt: entry.updatedAt,
                startedAt: live?.startedAt,
                pinned: pins.has(entry.sessionId),
                // Never-seen threads are NOT unseen — the registry adopts the
                // existing world silently; marks begin at the first open.
                unseen: seenAt ? entry.updatedAt > seenAt : false,
            });
        }
        threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return threads;
    }
}
