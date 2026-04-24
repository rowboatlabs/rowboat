import z from 'zod';
import { fetchAll, updateTrackBlock } from './fileops.js';
import { createRun, createMessage } from '../../runs/runs.js';
import { getTrackBlockModel } from '../../models/defaults.js';
import { extractAgentResponse, waitForRunCompletion } from '../../agents/utils.js';
import { trackBus } from './bus.js';
import type { TrackStateSchema } from './types.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';

export interface TrackUpdateResult {
    trackId: string;
    runId: string | null;
    action: 'replace' | 'no_update';
    contentBefore: string | null;
    contentAfter: string | null;
    summary: string | null;
    error?: string;
}

// ---------------------------------------------------------------------------
// Agent run
// ---------------------------------------------------------------------------

function buildMessage(
    filePath: string,
    track: z.infer<typeof TrackStateSchema>,
    trigger: 'manual' | 'timed' | 'event',
    context?: string,
): string {
    const now = new Date();
    const localNow = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    let msg = `Update track **${track.track.trackId}** in \`${filePath}\`.

**Time:** ${localNow} (${tz})

**Instruction:**
${track.track.instruction}

**Current content:**
${track.content || '(empty — first run)'}

Use \`update-track-content\` with filePath=\`${filePath}\` and trackId=\`${track.track.trackId}\`.`;

    if (trigger === 'event') {
        msg += `

**Trigger:** Event match (a Pass 1 routing classifier flagged this track as potentially relevant to the event below)

**Event match criteria for this track:**
${track.track.eventMatchCriteria ?? '(none — should not happen for event-triggered runs)'}

**Event payload:**
${context ?? '(no payload)'}

**Decision:** Determine whether this event genuinely warrants updating the track content. If the event is not meaningfully relevant on closer inspection, skip the update — do NOT call \`update-track-content\`. Only call the tool if the event provides new or changed information that should be reflected in the track.`;
    } else if (context) {
        msg += `\n\n**Context:**\n${context}`;
    }

    return msg;
}

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

const runningTracks = new Set<string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Trigger an update for a specific track block.
 * Can be called by any trigger system (manual, cron, event matching).
 */
export async function triggerTrackUpdate(
    trackId: string,
    filePath: string,
    context?: string,
    trigger: 'manual' | 'timed' | 'event' = 'manual',
): Promise<TrackUpdateResult> {
    const key = `${trackId}:${filePath}`;
    const logger = new PrefixLogger('track:runner');
    logger.log('triggering track update', trackId, filePath, trigger, context);
    if (runningTracks.has(key)) {
        logger.log('skipping, already running');
        return { trackId, runId: null, action: 'no_update', contentBefore: null, contentAfter: null, summary: null, error: 'Already running' };
    }
    runningTracks.add(key);

    try {
        const tracks = await fetchAll(filePath);
        logger.log('fetched tracks from file', tracks);
        const track = tracks.find(t => t.track.trackId === trackId);
        if (!track) {
            logger.log('track not found', trackId, filePath, trigger, context);
            return { trackId, runId: null, action: 'no_update', contentBefore: null, contentAfter: null, summary: null, error: 'Track not found' };
        }

        const contentBefore = track.content;

        // Per-track model/provider overrides win when set; otherwise fall back
        // to the configured trackBlockModel default and the run-creation
        // provider default (signed-in: rowboat; BYOK: active provider).
        const model = track.track.model ?? await getTrackBlockModel();
        const agentRun = await createRun({
            agentId: 'track-run',
            model,
            ...(track.track.provider ? { provider: track.track.provider } : {}),
        });

        // Set lastRunAt and lastRunId immediately (before agent executes) so
        // the scheduler's next poll won't re-trigger this track.
        await updateTrackBlock(filePath, trackId, {
            lastRunAt: new Date().toISOString(),
            lastRunId: agentRun.id,
        });

        await trackBus.publish({
            type: 'track_run_start',
            trackId,
            filePath,
            trigger,
            runId: agentRun.id,
        });

        try {
            await createMessage(agentRun.id, buildMessage(filePath, track, trigger, context));
            await waitForRunCompletion(agentRun.id);
            const summary = await extractAgentResponse(agentRun.id);

            const updatedTracks = await fetchAll(filePath);
            const contentAfter = updatedTracks.find(t => t.track.trackId === trackId)?.content;
            const didUpdate = contentAfter !== contentBefore;

            // Update summary on completion
            await updateTrackBlock(filePath, trackId, {
                lastRunSummary: summary ?? undefined,
            });

            await trackBus.publish({
                type: 'track_run_complete',
                trackId,
                filePath,
                runId: agentRun.id,
                summary: summary ?? undefined,
            });

            return {
                trackId,
                runId: agentRun.id,
                action: didUpdate ? 'replace' : 'no_update',
                contentBefore: contentBefore ?? null,
                contentAfter: contentAfter ?? null,
                summary,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);

            await trackBus.publish({
                type: 'track_run_complete',
                trackId,
                filePath,
                runId: agentRun.id,
                error: msg,
            });

            return { trackId, runId: agentRun.id, action: 'no_update', contentBefore: contentBefore ?? null, contentAfter: null, summary: null, error: msg };
        }
    } finally {
        runningTracks.delete(key);
    }
}
