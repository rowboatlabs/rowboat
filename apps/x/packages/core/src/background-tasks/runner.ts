import type { BackgroundTask, BackgroundTaskTriggerType } from '@x/shared/dist/background-task.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { fetchTask, patchTask, prependRunId } from './fileops.js';
import { getBackgroundTaskAgentModel } from '../models/defaults.js';
import { startHeadlessAgent } from '../agents/headless-app.js';
import { buildTriggerBlock } from '../agents/build-trigger-block.js';
import { backgroundTaskBus } from './bus.js';
import { withUseCase } from '../analytics/use_case.js';

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

function buildCodeBlock(slug: string, project: { id: string; path: string; name: string }): string {
    return `

# Coding task

This is a **coding task**. It is pinned to a code repository:
- **Project:** ${project.name}
- **Path:** \`${project.path}\`

Your job this run:
1. Read the relevant source (e.g. the meeting notes named in the trigger below) and identify **actionable coding items** — bugs to fix, features to build, concrete changes requested.
2. Be **conservative**: only implement items that are clearly scoped and self-contained. Items that are ambiguous, large/architectural, or about a different repository — do NOT code them. List them briefly in \`index.md\` as "needs review" instead.
3. **Group** related items together; keep unrelated items separate.
4. For each group, call the \`launch-code-task\` tool with \`taskSlug: "${slug}"\`, the \`meeting\` name/title these items came from (so sessions are grouped by meeting), a short \`title\`, the \`items\` summary, and a **detailed, fully self-contained \`prompt\`** describing exactly what to implement (the coding agent has no other context and no human to ask). Put the relevant meeting excerpt in \`context\`.
5. \`launch-code-task\` runs asynchronously in an isolated git worktree (full-auto) and manages a \`## Code Sessions\` section in \`index.md\` itself — **do not edit that section.** You may add a short note ABOVE it summarizing what you detected.

If there are no actionable coding items, launch nothing and say so in your final summary.`;
}

function buildMessage(
    slug: string,
    task: BackgroundTask,
    trigger: BackgroundTaskTriggerType,
    context?: string,
    codeProject?: { id: string; path: string; name: string },
): string {
    const now = new Date();
    const localNow = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const wsFolder = `bg-tasks/${slug}/`;

    const baseMessage = `Run the background task at \`${wsFolder}\`.

**Time:** ${localNow} (${tz})

**Instructions:**
${task.instructions}

Your task folder is \`${wsFolder}\`. The user-visible artifact is \`${wsFolder}index.md\` — read it with \`file-readText\` and update it with \`file-editText\` per the OUTPUT / ACTION mode rule. Do not touch \`${wsFolder}task.yaml\` (the runtime owns it).${codeProject ? buildCodeBlock(slug, codeProject) : ''}`;

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
        // Coding tasks carry a pinned code project — resolve it so the run
        // message can tell the agent which repo to work in.
        let codeProject: { id: string; path: string; name: string } | undefined;
        if (task.projectId) {
            try {
                const { default: container } = await import('../di/container.js');
                const projectsRepo = container.resolve<import('../code-mode/projects/repo.js').ICodeProjectsRepo>('codeProjectsRepo');
                const project = await projectsRepo.get(task.projectId);
                if (project) codeProject = { id: project.id, path: project.path, name: project.name };
            } catch (err) {
                log.log(`${slug} — could not resolve code project ${task.projectId}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        // task.yaml model/provider win; otherwise the category default
        // (provider-qualified in hybrid mode). A task model without a
        // provider keeps the legacy meaning: the app-default provider.
        const selection = await getBackgroundTaskAgentModel();
        const model = task.model || selection.model;
        const provider = task.provider ?? (task.model ? undefined : selection.provider);
        // Establish the use-case context for the whole turn so every tool the
        // agent calls (notably notify-user) reads `background_task_agent` via
        // getCurrentUseCase(); the AsyncLocalStorage context set here flows
        // through the turn's async execution chain.
        const handle = await withUseCase(
            { useCase: 'background_task_agent', subUseCase: trigger },
            () => startHeadlessAgent({
                agentId: 'background-task-agent',
                message: buildMessage(slug, task, trigger, context, codeProject),
                model,
                ...(provider ? { provider } : {}),
                throwOnError: true,
            }),
        );

        const runId = handle.turnId;
        // Record this turn in the task's runs.log pointer file (newest first).
        // The transcript itself lives at $WorkDir/storage/turns/YYYY/MM/DD/
        // — runs.log is just an index that ties turn ids to this task.
        await prependRunId(slug, runId);
        const startedAt = new Date().toISOString();

        log.log(`${slug} — start trigger=${trigger} runId=${runId}`);

        // Bump `lastAttemptAt` + `lastRunId` immediately (before the agent
        // executes). `lastAttemptAt` is the scheduler's backoff anchor and the
        // disk-persistent in-flight signal (lastAttemptAt > lastRunAt). Crucially
        // we leave `lastRunAt` / `lastRunSummary` / `lastRunError` untouched —
        // the previous successful run stays visible in the UI even while this
        // new run is in-flight or fails.
        // `projectId` is runtime-owned config the agent must never lose. A weak
        // model can clobber task.yaml mid-run (despite "never touch this"), which
        // would silently disable coding on later runs — so we re-assert it on
        // every patch to self-heal.
        const heal = task.projectId ? { projectId: task.projectId } : {};

        await patchTask(slug, {
            lastAttemptAt: startedAt,
            lastRunId: runId,
            ...heal,
        });

        backgroundTaskBus.publish({
            type: 'background_task_agent_start',
            slug,
            trigger,
            runId,
        });

        try {
            const { summary } = await handle.done;

            // Success — bump cycle anchor, refresh summary, clear any prior error.
            await patchTask(slug, {
                lastRunAt: new Date().toISOString(),
                lastRunSummary: summary ?? undefined,
                lastRunError: undefined,
                ...heal,
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
                await patchTask(slug, { lastRunError: msg, ...heal });
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
