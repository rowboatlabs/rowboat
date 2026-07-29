import { getDefaultModelAndProvider } from '../models/defaults.js';
import { withUseCase } from '../analytics/use_case.js';
import { notifyIfEnabled } from '../application/notification/notifier.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import type { TurnStreamEvent } from '@x/shared/dist/turns.js';
import type { ISessions } from '../runtime/sessions/api.js';
import { TurnNotSettledError } from '../runtime/sessions/api.js';
import type { ITurnEventBus } from '../runtime/turns/event-hub.js';
import { assistantText } from '../runtime/assembly/headless.js';
import { ASK_HUMAN_TOOL } from '../runtime/turns/bridges/real-agent-resolver.js';
import { attachReceipt, findItem, getItem, normalizeKey, setChecked, TODO_REL_PATH } from './fileops.js';
import { getSessionId, setSessionId } from './session-index.js';
import { todoBus } from './bus.js';

const log = new PrefixLogger('Todo:Runner');

// ---------------------------------------------------------------------------
// Each delegated item's thread IS a session in the run system: delegation
// starts it, inline comments and chat messages continue it, and the chat
// sidebar can open it like any other conversation. The runner's job is to
// drive turns from the list side and land the outcome back on todo.md as a
// receipt.
// ---------------------------------------------------------------------------

export interface TodoRunResult {
    key: string;
    sessionId: string | null;
    turnId: string | null;
    summary: string | null;
    error?: string;
}

const TURN_TIMEOUT_MS = 30 * 60 * 1000;
const ASK_HUMAN_TOOL_ID = `builtin:${ASK_HUMAN_TOOL}`;

function truncate(s: string | null | undefined, n = 120): string {
    if (!s) return '';
    return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Provider errors can be multi-line JSON walls — keep the first line. */
function errorLine(msg: string, n = 200): string {
    return truncate(msg.split('\n')[0], n);
}

function buildFirstMessage(text: string, context?: string, parentText?: string): string {
    const now = new Date();
    const localNow = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const partOf = parentText ? `\n**Part of:** ${parentText} — this item is one step of that larger to-do; scope your work to THIS step only.` : '';
    const report = parentText
        ? `report the outcome with \`todo-report\` (item text exactly as above, parent exactly as in **Part of**)`
        : `report the outcome with \`todo-report\` (item text exactly as above)`;
    const base = `Work on this item from the user's to-do list at \`${TODO_REL_PATH}\`:

**Item:** ${text}${partOf}
**Time:** ${localNow} (${tz})

Start by calling \`file-readText\` on \`${TODO_REL_PATH}\` — the surrounding list often carries context this item's phrasing assumes. Then do the work per your instructions, and ${report}.`;

    return context ? `${base}\n\n**Context from the user:**\n${context}` : base;
}

// ---------------------------------------------------------------------------
// Settle watching — mirror of ChannelBridge.watchBus (channels/bridge.ts):
// subscribe to the turn event spine BEFORE sending so no settle slips past.
// ---------------------------------------------------------------------------

type Settled =
    | { kind: 'completed'; text: string | null }
    | { kind: 'failed'; error: string }
    | { kind: 'cancelled' }
    | { kind: 'ask_human'; toolCallId: string; question: string }
    | { kind: 'suspended' }
    | { kind: 'timeout' };

function settleOf(event: TurnStreamEvent): Settled | null {
    switch (event.type) {
        case 'turn_completed':
            return { kind: 'completed', text: assistantText(event.output) };
        case 'turn_failed':
            return { kind: 'failed', error: event.error };
        case 'turn_cancelled':
            return { kind: 'cancelled' };
        case 'turn_suspended': {
            const ask = event.pendingAsyncTools.find(
                (t) => t.toolId === ASK_HUMAN_TOOL_ID || t.toolName === ASK_HUMAN_TOOL,
            );
            if (ask) {
                const input = ask.input as { question?: unknown } | null;
                const question =
                    typeof input?.question === 'string' && input.question
                        ? input.question
                        : 'The agent needs your input.';
                return { kind: 'ask_human', toolCallId: ask.toolCallId, question };
            }
            // Pending permission with no async tool: the turn waits for an
            // approval only the chat surface can give.
            if (event.pendingAsyncTools.length === 0 && event.pendingPermissions.length > 0) {
                return { kind: 'suspended' };
            }
            return null;
        }
        default:
            return null;
    }
}

interface SettleWatcher {
    waitFor(turnId: string, timeoutMs: number): Promise<Settled>;
    dispose(): void;
}

function watchSettles(bus: ITurnEventBus): SettleWatcher {
    const buffered: Array<{ turnId: string; settled: Settled }> = [];
    let waiter: { turnId: string; resolve: (settled: Settled) => void } | null = null;
    let cancelTimer: (() => void) | null = null;
    const unsubscribe = bus.subscribeAll((event) => {
        const settled = settleOf(event.event);
        if (!settled) return;
        if (waiter) {
            if (event.turnId === waiter.turnId) waiter.resolve(settled);
            return;
        }
        buffered.push({ turnId: event.turnId, settled });
    });
    return {
        waitFor: (turnId, timeoutMs) =>
            new Promise<Settled>((resolve) => {
                const hit = buffered.find((b) => b.turnId === turnId);
                if (hit) {
                    resolve(hit.settled);
                    return;
                }
                buffered.length = 0;
                const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
                cancelTimer = () => clearTimeout(timer);
                waiter = {
                    turnId,
                    resolve: (settled) => {
                        clearTimeout(timer);
                        resolve(settled);
                    },
                };
            }),
        dispose: () => {
            unsubscribe();
            cancelTimer?.();
        },
    };
}

// ---------------------------------------------------------------------------
// Concurrency guard — one list-driven turn per item. (A turn started from the
// chat surface isn't tracked here; sendMessage rejects with
// TurnNotSettledError in that case and we surface it.)
// ---------------------------------------------------------------------------

const runningItems = new Set<string>();
/** Suspended ask-human questions awaiting an answer, by item key. */
const pendingAsks = new Map<string, { turnId: string; toolCallId: string }>();

export function isItemRunning(key: string): boolean {
    return runningItems.has(normalizeKey(key));
}

export function runningItemKeys(): string[] {
    return [...runningItems];
}

// ---------------------------------------------------------------------------
// Session plumbing
// ---------------------------------------------------------------------------

async function resolveDeps(): Promise<{ sessions: ISessions; turnEventBus: ITurnEventBus }> {
    // Lazy DI resolution to break the module-init cycle (runner ← builtin
    // tools ← runtime ← container), mirroring notification/notifier.ts.
    const { lazyResolve } = await import('../di/lazy-resolve.js');
    return {
        sessions: await lazyResolve<ISessions>('sessions'),
        turnEventBus: await lazyResolve<ITurnEventBus>('turnEventBus'),
    };
}

/** The item's session, verified to still exist — or a fresh one. */
async function ensureSession(
    sessions: ISessions,
    key: string,
    title: string,
): Promise<{ sessionId: string; isNew: boolean }> {
    const existing = await getSessionId(key);
    if (existing) {
        try {
            await sessions.getSession(existing);
            return { sessionId: existing, isNew: false };
        } catch {
            // Session deleted — start over.
        }
    }
    const sessionId = await sessions.createSession({ title });
    await setSessionId(key, sessionId);
    return { sessionId, isNew: true };
}

async function landSettled(
    norm: string,
    itemText: string,
    receiptsBefore: number,
    sessionId: string,
    turnId: string,
    settled: Settled,
): Promise<TodoRunResult> {
    switch (settled.kind) {
        case 'completed': {
            // The agent reports via todo-report; if it never did, land the
            // turn's reply as a receipt so work is surfaced, box open.
            const after = await getItem(norm);
            if (after && !after.checked && after.receipts.length === receiptsBefore && settled.text) {
                await attachReceipt(norm, { kind: 'result', text: truncate(settled.text, 300), links: [] });
            }
            log.log(`done turn=${turnId} summary="${truncate(settled.text)}"`);
            todoBus.publish({ type: 'run_complete', key: norm, summary: settled.text ?? undefined });
            void notifyIfEnabled('background_task', {
                title: '✓ To-do finished',
                message: settled.text ?? itemText,
                link: 'rowboat://open?type=home',
            });
            return { key: norm, sessionId, turnId, summary: settled.text };
        }
        case 'failed': {
            await attachReceipt(norm, { kind: 'error', text: errorLine(settled.error), links: [] }).catch(() => {});
            log.log(`failed turn=${turnId}: ${truncate(settled.error)}`);
            todoBus.publish({ type: 'run_error', key: norm, error: settled.error });
            return { key: norm, sessionId, turnId, summary: null, error: settled.error };
        }
        case 'cancelled': {
            todoBus.publish({ type: 'run_error', key: norm, error: 'Stopped' });
            return { key: norm, sessionId, turnId, summary: null, error: 'Stopped' };
        }
        case 'ask_human': {
            pendingAsks.set(norm, { turnId, toolCallId: settled.toolCallId });
            await attachReceipt(norm, { kind: 'question', text: settled.question, links: [] }).catch(() => {});
            todoBus.publish({ type: 'run_complete', key: norm });
            return { key: norm, sessionId, turnId, summary: null };
        }
        case 'suspended': {
            await attachReceipt(norm, {
                kind: 'question',
                text: 'waiting for a permission approval — open this item\'s chat to continue',
                links: [],
            }).catch(() => {});
            todoBus.publish({ type: 'run_complete', key: norm });
            return { key: norm, sessionId, turnId, summary: null };
        }
        case 'timeout': {
            // The turn may still finish later — todo-report receipts land
            // regardless; only the spinner and notification are given up.
            log.log(`timeout waiting on turn=${turnId}`);
            todoBus.publish({ type: 'run_complete', key: norm });
            return { key: norm, sessionId, turnId, summary: null, error: 'Timed out waiting' };
        }
    }
}

async function driveTurn(
    norm: string,
    itemText: string,
    receiptsBefore: number,
    sessionId: string,
    message: string,
    subUseCase: string,
    modelOverride?: { provider: string; model: string },
    autoPermission = true,
): Promise<TodoRunResult> {
    const { sessions, turnEventBus } = await resolveDeps();
    const watcher = watchSettles(turnEventBus);
    try {
        let sent: { turnId: string };
        try {
            // Chat parity: the assistant model unless the composer overrode it.
            const { model, provider } = modelOverride ?? await getDefaultModelAndProvider();
            sent = await withUseCase(
                { useCase: 'todo_item_agent', subUseCase },
                () => sessions.sendMessage(
                    sessionId,
                    { role: 'user', content: message },
                    {
                        agent: {
                            agentId: 'todo-item-agent',
                            overrides: { model: { provider, model } },
                        },
                        autoPermission,
                    },
                ),
            );
        } catch (err) {
            if (err instanceof TurnNotSettledError) {
                return { key: norm, sessionId, turnId: null, summary: null, error: 'Already running — open the chat to see progress' };
            }
            // Failures before the turn exists (no model configured, agent
            // resolution) must surface exactly like run failures — an
            // invisible no-op teaches the user the list is broken.
            const msg = err instanceof Error ? err.message : String(err);
            await attachReceipt(norm, { kind: 'error', text: errorLine(msg), links: [] }).catch(() => {});
            log.log(`failed to start: ${truncate(msg)}`);
            todoBus.publish({ type: 'run_error', key: norm, error: msg });
            return { key: norm, sessionId, turnId: null, summary: null, error: msg };
        }

        log.log(`turn=${sent.turnId} session=${sessionId} item="${truncate(itemText, 80)}"`);
        todoBus.publish({ type: 'run_start', key: norm });
        // A manual-permission run suspends until the user approves from the
        // item's chat — surface it once, then KEEP WAITING so the completion
        // receipt still lands after approval.
        const deadline = Date.now() + TURN_TIMEOUT_MS;
        let surfacedSuspension = false;
        for (;;) {
            const settled = await watcher.waitFor(sent.turnId, Math.max(1000, deadline - Date.now()));
            if (settled.kind !== 'suspended') {
                return await landSettled(norm, itemText, receiptsBefore, sessionId, sent.turnId, settled);
            }
            if (!surfacedSuspension) {
                surfacedSuspension = true;
                await attachReceipt(norm, {
                    kind: 'question',
                    text: 'waiting for your approval — open this item\'s chat to allow it',
                    links: [],
                }).catch(() => {});
                todoBus.publish({ type: 'attention', key: norm, message: 'waiting for your approval' });
                void notifyIfEnabled('agent_permission', {
                    title: 'Rowboat needs an approval',
                    message: itemText,
                    link: 'rowboat://open?type=home',
                });
            }
        }
    } finally {
        watcher.dispose();
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run one delegated item, identified by its line text. User-initiated
 * (typing @rowboat, the run chip, retry). Fire-and-forget from IPC:
 * progress and completion arrive on the todo bus.
 */
export async function runTodoItem(
    key: string,
    context?: string,
    opts?: { model?: { provider: string; model: string }; autoPermission?: boolean },
): Promise<TodoRunResult> {
    const norm = normalizeKey(key);
    if (runningItems.has(norm)) {
        log.log(`"${truncate(norm, 60)}" — skip: already running`);
        return { key: norm, sessionId: null, turnId: null, summary: null, error: 'Already running' };
    }
    runningItems.add(norm);
    try {
        const found = await findItem(norm);
        if (!found) {
            return { key: norm, sessionId: null, turnId: null, summary: null, error: 'Item not found' };
        }
        const { item, parent } = found;
        if (item.checked) {
            return { key: norm, sessionId: null, turnId: null, summary: null, error: 'Item is already done' };
        }
        if (item.proposed && item.receipts.length === 0) {
            // The user gave a planner proposal its go — a positive signal.
            const { recordPlannerSignal } = await import('./planner-memory.js');
            void recordPlannerSignal('ran', item.text).catch(() => {});
        }
        const { sessions } = await resolveDeps();
        const title = parent ? `${item.text} · ${parent.text}` : item.text;
        const { sessionId } = await ensureSession(sessions, item.key, title);
        return await driveTurn(item.key, item.text, item.receipts.length, sessionId, buildFirstMessage(item.text, context, parent?.text), 'manual', opts?.model, opts?.autoPermission ?? true);
    } finally {
        runningItems.delete(norm);
    }
}

// ---------------------------------------------------------------------------
// Home-stream chat threads — plain messages from the home composer. Same
// thread machinery as to-do items, but the copilot answers and nothing
// touches todo.md: no receipts, no checkbox, just the conversation. Events
// ride the todo bus keyed `chat:<sessionId>` so the stream shows live state.
// ---------------------------------------------------------------------------

export interface HomeChatResult {
    sessionId: string | null;
    turnId: string | null;
    error?: string;
}

async function driveChatTurn(
    sessionId: string,
    message: string,
    modelOverride?: { provider: string; model: string },
    autoPermission = true,
): Promise<HomeChatResult> {
    const key = `chat:${sessionId}`;
    if (runningItems.has(key)) {
        return { sessionId, turnId: null, error: 'Already running' };
    }
    runningItems.add(key);
    const { sessions, turnEventBus } = await resolveDeps();
    const watcher = watchSettles(turnEventBus);
    try {
        let sent: { turnId: string };
        try {
            const { model, provider } = modelOverride ?? await getDefaultModelAndProvider();
            sent = await withUseCase(
                { useCase: 'copilot_chat', subUseCase: 'home_stream' },
                () => sessions.sendMessage(
                    sessionId,
                    { role: 'user', content: message },
                    {
                        agent: {
                            agentId: 'copilot',
                            overrides: { model: { provider, model } },
                        },
                        autoPermission,
                    },
                ),
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (err instanceof TurnNotSettledError) {
                return { sessionId, turnId: null, error: 'Already running — open the chat to see progress' };
            }
            log.log(`chat failed to start: ${truncate(msg)}`);
            todoBus.publish({ type: 'run_error', key, error: msg });
            return { sessionId, turnId: null, error: msg };
        }

        todoBus.publish({ type: 'run_start', key });
        // A manual-permission turn suspends until the user approves from the
        // chat — surface it once, then keep waiting so the thread still shows
        // completion after approval.
        const deadline = Date.now() + TURN_TIMEOUT_MS;
        let surfacedSuspension = false;
        for (;;) {
            const settled = await watcher.waitFor(sent.turnId, Math.max(1000, deadline - Date.now()));
            if (settled.kind === 'suspended') {
                if (!surfacedSuspension) {
                    surfacedSuspension = true;
                    todoBus.publish({ type: 'attention', key, message: 'waiting for your approval' });
                    void notifyIfEnabled('agent_permission', {
                        title: 'Rowboat needs an approval',
                        message: truncate(message, 120),
                        link: 'rowboat://open?type=home',
                    });
                }
                continue;
            }
            if (settled.kind === 'failed') {
                todoBus.publish({ type: 'run_error', key, error: settled.error });
                return { sessionId, turnId: sent.turnId, error: settled.error };
            }
            // Completed / question / cancelled / timeout all just end the
            // spinner — the conversation itself is the record.
            todoBus.publish({ type: 'run_complete', key });
            return { sessionId, turnId: sent.turnId };
        }
    } finally {
        watcher.dispose();
        runningItems.delete(key);
    }
}

/** A plain message from the home composer: new copilot session, first turn.
 * Returns as soon as the session exists (the caller needs its id to render
 * the thread); the turn itself is fire-and-forget — progress arrives on
 * todo:events. The session auto-titles from the message like any chat. */
export async function startHomeChat(text: string): Promise<HomeChatResult> {
    const { sessions } = await resolveDeps();
    const sessionId = await sessions.createSession();
    todoBus.publish({ type: 'list_changed' });
    void driveChatTurn(sessionId, text).catch(() => {});
    return { sessionId, turnId: null };
}

/** An inline reply on a stream thread — the next user message in it. */
export async function replyHomeChat(
    sessionId: string,
    message: string,
    opts?: { model?: { provider: string; model: string }; autoPermission?: boolean },
): Promise<HomeChatResult> {
    return driveChatTurn(sessionId, message, opts?.model, opts?.autoPermission ?? true);
}

/**
 * An inline comment on an item — the lightweight door into its thread. If
 * the agent left an ask-human question, this answers it; otherwise it lands
 * as the next user message in the item's session (reopening a checked
 * item). Never a separate history: the chat surface shows the same session.
 */
export async function commentOnTodoItem(
    key: string,
    message: string,
    opts?: { model?: { provider: string; model: string }; autoPermission?: boolean },
): Promise<TodoRunResult> {
    const norm = normalizeKey(key);
    if (runningItems.has(norm)) {
        return { key: norm, sessionId: null, turnId: null, summary: null, error: 'Already running' };
    }
    runningItems.add(norm);
    try {
        const found = await findItem(norm);
        if (!found) {
            return { key: norm, sessionId: null, turnId: null, summary: null, error: 'Item not found' };
        }
        const { item, parent } = found;
        if (item.checked) {
            await setChecked(item.key, false);
            todoBus.publish({ type: 'list_changed' });
        }

        const { sessions, turnEventBus } = await resolveDeps();

        // A suspended ask-human turn is answered in place, not messaged over.
        const ask = pendingAsks.get(norm);
        if (ask) {
            pendingAsks.delete(norm);
            const watcher = watchSettles(turnEventBus);
            try {
                const settledPromise = watcher.waitFor(ask.turnId, TURN_TIMEOUT_MS);
                // Race per channels/bridge.ts answerAsk: respondToAskHuman
                // resolves only when the advance settles; its rejection
                // (stale ask) must win the race so we can fall back.
                const settled = await Promise.race([
                    settledPromise,
                    sessions
                        .respondToAskHuman(ask.turnId, ask.toolCallId, message)
                        .then(() => settledPromise),
                ]);
                todoBus.publish({ type: 'run_start', key: norm });
                return await landSettled(norm, item.text, item.receipts.length, (await getSessionId(norm)) ?? '', ask.turnId, settled);
            } catch {
                // Stale ask (answered from the chat surface, or turn gone) —
                // fall through and send as a normal message.
            } finally {
                watcher.dispose();
            }
        }

        const title = parent ? `${item.text} · ${parent.text}` : item.text;
        const { sessionId, isNew } = await ensureSession(sessions, item.key, title);
        const text = isNew ? buildFirstMessage(item.text, message, parent?.text) : message;
        return await driveTurn(item.key, item.text, item.receipts.length, sessionId, text, 'comment', opts?.model, opts?.autoPermission ?? true);
    } finally {
        runningItems.delete(norm);
    }
}
