import { getBackgroundTaskAgentModel } from '../models/defaults.js';
import { startHeadlessAgent } from '../runtime/assembly/headless-app.js';
import { withUseCase } from '../analytics/use_case.js';
import { notifyIfEnabled } from '../application/notification/notifier.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { attachReceipt, getItem, normalizeKey, setChecked, TODO_REL_PATH } from './fileops.js';
import { appendThreadEntry, readThread, renderThreadForContext } from './threads.js';
import { todoBus } from './bus.js';

const log = new PrefixLogger('Todo:Runner');

export interface TodoRunResult {
    key: string;
    runId: string | null;
    summary: string | null;
    error?: string;
}

function truncate(s: string | null | undefined, n = 120): string {
    if (!s) return '';
    return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function buildMessage(text: string, context?: string): string {
    const now = new Date();
    const localNow = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const base = `Work on this item from the user's to-do list at \`${TODO_REL_PATH}\`:

**Item:** ${text}
**Time:** ${localNow} (${tz})

Start by calling \`file-readText\` on \`${TODO_REL_PATH}\` — the surrounding list often carries context this item's phrasing assumes. Then do the work per your instructions, and report the outcome with \`todo-report\` (item text exactly as above).`;

    return context ? `${base}\n\n**Context:**\n${context}` : base;
}

// ---------------------------------------------------------------------------
// Concurrency guard — one run per item
// ---------------------------------------------------------------------------

const runningItems = new Set<string>();

export function isItemRunning(key: string): boolean {
    return runningItems.has(normalizeKey(key));
}

export function runningItemKeys(): string[] {
    return [...runningItems];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the to-do item agent on one delegated item, identified by its line
 * text. User-initiated (typing @rowboat, the go chip, retry), so it never
 * defers behind active chats. Fire-and-forget from IPC: progress and
 * completion arrive on the todo bus.
 */
export async function runTodoItem(key: string, context?: string): Promise<TodoRunResult> {
    const norm = normalizeKey(key);
    if (runningItems.has(norm)) {
        log.log(`"${truncate(norm, 60)}" — skip: already running`);
        return { key: norm, runId: null, summary: null, error: 'Already running' };
    }
    runningItems.add(norm);

    try {
        const item = await getItem(norm);
        if (!item) {
            return { key: norm, runId: null, summary: null, error: 'Item not found' };
        }
        if (item.checked) {
            return { key: norm, runId: null, summary: null, error: 'Item is already done' };
        }
        const receiptsBefore = item.receipts.length;

        // Failures before the run exists (no model configured, agent
        // resolution) must surface exactly like run failures — an invisible
        // no-op teaches the user the list is broken.
        let handle;
        try {
            const { model, provider } = await getBackgroundTaskAgentModel();
            handle = await withUseCase(
                { useCase: 'todo_item_agent', subUseCase: 'manual' },
                () => startHeadlessAgent({
                    agentId: 'todo-item-agent',
                    message: buildMessage(item.text, context),
                    model,
                    provider,
                    throwOnError: true,
                }),
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await attachReceipt(norm, { kind: 'error', text: truncate(msg, 200), links: [] }).catch(() => {});
            await appendThreadEntry(norm, {
                author: 'rowboat',
                at: new Date().toISOString(),
                text: `Run failed to start: ${truncate(msg, 200)}`,
            }).catch(() => {});
            log.log(`failed to start: ${truncate(msg)}`);
            todoBus.publish({ type: 'run_error', key: norm, error: msg });
            return { key: norm, runId: null, summary: null, error: msg };
        }

        log.log(`start runId=${handle.turnId} item="${truncate(item.text, 80)}"`);
        todoBus.publish({ type: 'run_start', key: norm });

        try {
            const { summary } = await handle.done;

            // The agent reports via todo-report; if it never did (older
            // models, tool failure), land the run summary as a receipt so
            // the work is surfaced rather than silently swallowed. Box
            // stays open — nothing was verified done.
            const after = await getItem(norm);
            if (after && !after.checked && after.receipts.length === receiptsBefore && summary) {
                await attachReceipt(norm, { kind: 'result', text: summary, links: [] });
            }

            if (summary) {
                await appendThreadEntry(norm, {
                    author: 'rowboat',
                    at: new Date().toISOString(),
                    text: summary,
                    runId: handle.turnId,
                }).catch(() => {});
            }

            log.log(`done runId=${handle.turnId} summary="${truncate(summary)}"`);
            todoBus.publish({ type: 'run_complete', key: norm, summary: summary ?? undefined });
            void notifyIfEnabled('background_task', {
                title: '✓ To-do finished',
                message: summary ?? item.text,
                link: 'rowboat://open?type=home',
            });
            return { key: norm, runId: handle.turnId, summary };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await attachReceipt(norm, { kind: 'error', text: truncate(msg, 200), links: [] }).catch(() => {
                // Item removed mid-run — treat as dismissed.
            });
            await appendThreadEntry(norm, {
                author: 'rowboat',
                at: new Date().toISOString(),
                text: `Run failed: ${truncate(msg, 200)}`,
                runId: handle.turnId,
            }).catch(() => {});
            log.log(`failed runId=${handle.turnId}: ${truncate(msg)}`);
            todoBus.publish({ type: 'run_error', key: norm, error: msg });
            return { key: norm, runId: handle.turnId, summary: null, error: msg };
        }
    } finally {
        runningItems.delete(norm);
    }
}

/**
 * A follow-up from the item's thread panel: record the user's message,
 * reopen the item (a finished attempt is now being revised), and re-run
 * with the whole thread as context so the agent builds on its previous
 * attempt instead of starting cold.
 */
export async function followUpTodoItem(key: string, message: string): Promise<TodoRunResult> {
    const norm = normalizeKey(key);
    if (runningItems.has(norm)) {
        return { key: norm, runId: null, summary: null, error: 'Already running' };
    }
    const item = await getItem(norm);
    if (!item) {
        return { key: norm, runId: null, summary: null, error: 'Item not found' };
    }

    await appendThreadEntry(norm, { author: 'user', at: new Date().toISOString(), text: message });
    if (item.checked) await setChecked(norm, false);
    todoBus.publish({ type: 'list_changed' });

    const thread = await readThread(norm);
    const context = [
        'This item has a conversation thread. Earlier entries are history; the LAST user message is the directive for THIS run — revise or continue your previous work accordingly, building on artifacts you already made rather than starting over.',
        '',
        renderThreadForContext(thread),
    ].join('\n');

    return runTodoItem(norm, context);
}
