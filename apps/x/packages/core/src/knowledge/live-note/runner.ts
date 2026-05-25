import type { LiveNote, LiveNoteTriggerType } from '@x/shared/dist/live-note.js';
import { fetchLiveNote, patchLiveNote, readNoteBody } from './fileops.js';
import { createRun, createMessage } from '../../runs/runs.js';
import { getLiveNoteAgentModel } from '../../models/defaults.js';
import { extractAgentResponse, waitForRunCompletion } from '../../agents/utils.js';
import { buildTriggerBlock } from '../../agents/build-trigger-block.js';
import { liveNoteBus } from './bus.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';

const log = new PrefixLogger('LiveNote:Agent');

export interface LiveNoteAgentResult {
    filePath: string;
    runId: string | null;
    action: 'replace' | 'no_update';
    contentBefore: string | null;
    contentAfter: string | null;
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

const LIVE_NOTE_EVENT_DECISION_DIRECTIVE = '**Decision:** Determine whether this event genuinely warrants updating the note. If the event is not meaningfully relevant on closer inspection, skip the update — do not call `file-editText`. Only edit the file if the event provides new or changed information that the objective implies should be reflected.';

const LIVE_NOTE_MANUAL_PAREN = 'user-triggered — either the Run button in the Live Note panel or the `run-live-note-agent` tool';

function buildMessage(
    filePath: string,
    live: LiveNote,
    trigger: LiveNoteTriggerType,
    context?: string,
): string {
    const now = new Date();
    const localNow = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Workspace-relative path the agent's tools (file-readText,
    // file-editText) expect. Internal storage is knowledge/-relative.
    const wsPath = `knowledge/${filePath}`;

    const baseMessage = `Update the live note at \`${wsPath}\`.

**Time:** ${localNow} (${tz})

**Objective:**
${live.objective}

Start by calling \`file-readText\` on \`${wsPath}\` to read the current note (frontmatter + body) — the body may be long and you should fetch it yourself rather than rely on a snapshot. Then make small, incremental edits with \`file-editText\` to bring the body in line with the objective: edit one region, re-read to verify, then edit the next region. Avoid one-shot rewrites of the whole body. Do not modify the YAML frontmatter at the top of the file — that block is owned by the user and the runtime.`;

    return baseMessage + buildTriggerBlock({
        trigger,
        triggers: live.triggers,
        // The live-note "event" branch passes the payload as `context`; for
        // every other trigger that same arg is the manual/scheduled context
        // appended to the block. Preserve both contracts with a single split.
        context: trigger === 'event' ? undefined : context,
        eventPayload: trigger === 'event' ? context : undefined,
        targetNoun: 'note',
        instructionsNoun: 'objective',
        manualParen: LIVE_NOTE_MANUAL_PAREN,
        eventDecisionDirective: LIVE_NOTE_EVENT_DECISION_DIRECTIVE,
    });
}

// ---------------------------------------------------------------------------
// Concurrency guard — keyed by filePath
// ---------------------------------------------------------------------------

const runningLiveNotes = new Set<string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the live-note agent on a specific note.
 * Called by the scheduler ('cron' | 'window'), the event processor ('event'),
 * the renderer panel Run button ('manual'), or the `run-live-note-agent`
 * builtin tool ('manual').
 */
export async function runLiveNoteAgent(
    filePath: string,
    trigger: LiveNoteTriggerType = 'manual',
    context?: string,
): Promise<LiveNoteAgentResult> {
    if (runningLiveNotes.has(filePath)) {
        log.log(`${filePath} — skip: already running`);
        return { filePath, runId: null, action: 'no_update', contentBefore: null, contentAfter: null, summary: null, error: 'Already running' };
    }
    runningLiveNotes.add(filePath);

    try {
        const live = await fetchLiveNote(filePath);
        if (!live) {
            log.log(`${filePath} — skip: note is not live (no \`live:\` block)`);
            return { filePath, runId: null, action: 'no_update', contentBefore: null, contentAfter: null, summary: null, error: 'Note is not live' };
        }

        const bodyBefore = await readNoteBody(filePath);

        const model = live.model ?? await getLiveNoteAgentModel();
        const agentRun = await createRun({
            agentId: 'live-note-agent',
            model,
            ...(live.provider ? { provider: live.provider } : {}),
            useCase: 'live_note_agent',
            // Use the granular trigger as the analytics sub-use-case so
            // dashboards can break down agent runs by what woke them up
            // (manual / cron / window / event). Pass 1 routing emits the
            // separate `routing` sub-use-case from routing.ts.
            subUseCase: trigger,
        });

        log.log(`${filePath} — start trigger=${trigger} runId=${agentRun.id}`);

        // Bump `lastAttemptAt` immediately (before the agent executes) so the
        // scheduler's next poll suppresses duplicate firings during a slow run
        // and applies a backoff after a failure. `lastRunAt` is only bumped on
        // *success* below — that way failures don't lock the cycle anchor for
        // cron / window triggers.
        await patchLiveNote(filePath, {
            lastAttemptAt: new Date().toISOString(),
            lastRunId: agentRun.id,
        });

        await liveNoteBus.publish({
            type: 'live_note_agent_start',
            filePath,
            trigger,
            runId: agentRun.id,
        });

        try {
            await createMessage(agentRun.id, buildMessage(filePath, live, trigger, context));
            // throwOnError: surface any error event in the run's log (LLM API
            // failures, tool errors, billing/credit issues) as a rejection so
            // the failure branch records lastRunError. Without this the run
            // can "complete" with errors silently and we'd hit the success
            // branch with an empty summary, clobbering any prior lastRunError.
            await waitForRunCompletion(agentRun.id, { throwOnError: true });
            const summary = await extractAgentResponse(agentRun.id);

            const bodyAfter = await readNoteBody(filePath);
            const didUpdate = bodyAfter !== bodyBefore;

            // Success — bump the cycle anchor, refresh the summary, clear any
            // prior error.
            await patchLiveNote(filePath, {
                lastRunAt: new Date().toISOString(),
                lastRunSummary: summary ?? undefined,
                lastRunError: undefined,
            });

            log.log(`${filePath} — done action=${didUpdate ? 'replace' : 'no_update'} summary="${truncate(summary)}"`);

            await liveNoteBus.publish({
                type: 'live_note_agent_complete',
                filePath,
                runId: agentRun.id,
                summary: summary ?? undefined,
            });

            return {
                filePath,
                runId: agentRun.id,
                action: didUpdate ? 'replace' : 'no_update',
                contentBefore: bodyBefore,
                contentAfter: bodyAfter,
                summary,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);

            // Failure — keep `lastRunAt` and `lastRunSummary` intact so the
            // user keeps seeing the last good state. Just record the error;
            // the scheduler's backoff (lastAttemptAt + 5min) prevents storming.
            try {
                await patchLiveNote(filePath, { lastRunError: msg });
            } catch {
                // Don't mask the original error if the patch itself fails.
            }

            log.log(`${filePath} — failed: ${truncate(msg)}`);

            await liveNoteBus.publish({
                type: 'live_note_agent_complete',
                filePath,
                runId: agentRun.id,
                error: msg,
            });

            return { filePath, runId: agentRun.id, action: 'no_update', contentBefore: bodyBefore, contentAfter: null, summary: null, error: msg };
        }
    } finally {
        runningLiveNotes.delete(filePath);
    }
}
