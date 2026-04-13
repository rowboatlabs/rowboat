import z from 'zod';
import { fetchAll, updateTrackBlock } from './fileops.js';
import { createRun, createMessage } from '../../runs/runs.js';
import { extractAgentResponse, waitForRunCompletion } from '../../agents/utils.js';
import { trackBus } from './bus.js';
import type { TrackStateSchema } from './types.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';

export interface TrackUpdateResult {
    trackId: string;
    action: 'replace' | 'no_update';
    contentBefore: string | null;
    contentAfter: string | null;
    summary: string | null;
    error?: string;
}

// ---------------------------------------------------------------------------
// Agent run
// ---------------------------------------------------------------------------

function buildMessage(filePath: string, track: z.infer<typeof TrackStateSchema>, context?: string): string {
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

    if (context) {
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
        return { trackId, action: 'no_update', contentBefore: null, contentAfter: null, summary: null, error: 'Already running' };
    }
    runningTracks.add(key);

    try {
        const tracks = await fetchAll(filePath);
        logger.log('fetched tracks from file', tracks);
        const track = tracks.find(t => t.track.trackId === trackId);
        if (!track) {
            logger.log('track not found', trackId, filePath, trigger, context);
            return { trackId, action: 'no_update', contentBefore: null, contentAfter: null, summary: null, error: 'Track not found' };
        }

        const contentBefore = track.content;

        // Emit start event — runId is set after agent run is created
        const agentRun = await createRun({ agentId: 'track-run' });

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
            await createMessage(agentRun.id, buildMessage(filePath, track, context));
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

            return { trackId, action: 'no_update', contentBefore: contentBefore ?? null, contentAfter: null, summary: null, error: msg };
        }
    } finally {
        runningTracks.delete(key);
    }
}
