import type { BackgroundTask, BackgroundTaskTriggerType } from '@x/shared/dist/background-task.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { fetchTask, patchTask, prependRunId } from './fileops.js';
import { createRun, createMessage } from '../runs/runs.js';
import { getBackgroundTaskAgentModel } from '../models/defaults.js';
import { extractAgentResponse, waitForRunCompletion } from '../agents/utils.js';
import { buildTriggerBlock } from '../agents/build-trigger-block.js';
import { backgroundTaskBus } from './bus.js';

const log = new PrefixLogger('BgTask:Agent');

export interface BackgroundTaskAgentResult {
    slug: string;
    runId: string | null;
    summary: string | null;
    error?: string;
}

const SUMMARY_LOG_LIMIT = 120;

function truncate(s: string | null | undefined, n = SUMMARY_LOG_LIMIT): string {
    if (!s) return '';
    return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// ---------------------------------------------------------------------------
// Agent run message
// ---------------------------------------------------------------------------

const BG_TASK_EVENT_DECISION_DIRECTIVE = '**Decision:** Determine whether this event genuinely warrants taking the action your instructions describe. If the event is not meaningfully relevant on closer inspection, skip the run — do not modify `index.md` and do not perform any side-effect. Only act if the event provides new or changed information that the instructions imply you should react to.';

const BG_TASK_MANUAL_PAREN = 'user-triggered — either the Run button in the Background Task detail view or the `run-background-task-agent` tool';

function buildMessage(
    slug: string,
    task: BackgroundTask,
    trigger: BackgroundTaskTriggerType,
    context?: string,
): string {
    const now = new Date();
    const localNow = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const wsFolder = `bg-tasks/${slug}/`;

    const baseMessage = `Run the background task at \`${wsFolder}\`.

**Time:** ${localNow} (${tz})

**Instructions:**
${task.instructions}

Your task folder is \`${wsFolder}\`. The user-visible artifact is \`${wsFolder}index.md\` — read it with \`file-readText\` and update it with \`file-editText\` per the OUTPUT / ACTION mode rule. Do not touch \`${wsFolder}task.yaml\` (the runtime owns it).`;

    return baseMessage + buildTriggerBlock({
        trigger,
        triggers: task.triggers,
        // The 'event' branch passes the event payload as `context`; every
        // other trigger uses `context` as a one-off bias for THIS run.
        context: trigger === 'event' ? undefined : context,
        eventPayload: trigger === 'event' ? context : undefined,
        targetNoun: 'task',
        instructionsNoun: 'instructions',
        manualParen: BG_TASK_MANUAL_PAREN,
        eventDecisionDirective: BG_TASK_EVENT_DECISION_DIRECTIVE,
    });
}

// ---------------------------------------------------------------------------
// Concurrency guard — keyed by slug
// ---------------------------------------------------------------------------

const runningTasks = new Set<string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the bg-task agent on a specific task.
 * Called by the scheduler ('cron' | 'window'), the event processor ('event'),
 * the renderer detail Run button ('manual'), or the `run-background-task-agent`
 * builtin tool ('manual').
 */
export async function runBackgroundTask(
    slug: string,
    trigger: BackgroundTaskTriggerType = 'manual',
    context?: string,
): Promise<BackgroundTaskAgentResult> {
    if (runningTasks.has(slug)) {
        log.log(`${slug} — skip: already running`);
        return { slug, runId: null, summary: null, error: 'Already running' };
    }
    runningTasks.add(slug);

    try {
        const task = await fetchTask(slug);
        if (!task) {
            log.log(`${slug} — skip: task not found`);
            return { slug, runId: null, summary: null, error: 'Task not found' };
        }

        // `||` not `??`: an empty-string `task.model` (occasionally synthesized
        // by an LLM call to create-background-task) should fall through to the
        // default just like undefined does.
        const model = task.model || await getBackgroundTaskAgentModel();
        const agentRun = await createRun({
            agentId: 'background-task-agent',
            model,
            ...(task.provider ? { provider: task.provider } : {}),
            useCase: 'background_task_agent',
            // Granular trigger as analytics sub-use-case — matches live-note's
            // pattern at runner.ts:149.
            subUseCase: trigger,
        });

        const runId = agentRun.id;
        // Record this run in the task's runs.log pointer file (newest first).
        // The transcript itself lives at the global $WorkDir/runs/<runId>.jsonl
        // — runs.log is just an index that ties runIds to this task.
        await prependRunId(slug, runId);
        const startedAt = new Date().toISOString();

        log.log(`${slug} — start trigger=${trigger} runId=${runId}`);

        // Bump `lastAttemptAt` + `lastRunId` immediately (before the agent
        // executes). `lastAttemptAt` is the scheduler's backoff anchor and the
        // disk-persistent in-flight signal (lastAttemptAt > lastRunAt). Crucially
        // we leave `lastRunAt` / `lastRunSummary` / `lastRunError` untouched —
        // the previous successful run stays visible in the UI even while this
        // new run is in-flight or fails.
        await patchTask(slug, {
            lastAttemptAt: startedAt,
            lastRunId: runId,
        });

        backgroundTaskBus.publish({
            type: 'background_task_agent_start',
            slug,
            trigger,
            runId,
        });

        try {
            await createMessage(runId, buildMessage(slug, task, trigger, context));
            await waitForRunCompletion(runId, { throwOnError: true });
            const summary = await extractAgentResponse(runId);

            // Success — bump cycle anchor, refresh summary, clear any prior error.
            await patchTask(slug, {
                lastRunAt: new Date().toISOString(),
                lastRunSummary: summary ?? undefined,
                lastRunError: undefined,
            });

            log.log(`${slug} — done summary="${truncate(summary)}"`);

            backgroundTaskBus.publish({
                type: 'background_task_agent_complete',
                slug,
                runId,
                ...(summary ? { summary } : {}),
            });

            return { slug, runId, summary };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);

            // Failure — only record the error. `lastRunAt` and `lastRunSummary`
            // are deliberately untouched so the user keeps seeing the last good
            // state; the scheduler's backoff (lastAttemptAt + 5min) prevents
            // retry-storming.
            try {
                await patchTask(slug, { lastRunError: msg });
            } catch {
                // don't mask the original error
            }

            log.log(`${slug} — failed: ${truncate(msg)}`);

            backgroundTaskBus.publish({
                type: 'background_task_agent_complete',
                slug,
                runId,
                error: msg,
            });

            return { slug, runId, summary: null, error: msg };
        }
    } finally {
        runningTasks.delete(slug);
    }
}
