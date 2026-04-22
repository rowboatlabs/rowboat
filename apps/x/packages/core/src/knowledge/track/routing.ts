import { generateObject } from 'ai';
import { trackBlock, PrefixLogger } from '@x/shared';
import type { KnowledgeEvent } from '@x/shared/dist/track-block.js';
import { createProvider } from '../../models/models.js';
import { getDefaultModelAndProvider, resolveProviderConfig } from '../../models/defaults.js';

const log = new PrefixLogger('TrackRouting');

const BATCH_SIZE = 20;

export interface ParsedTrack {
    trackId: string;
    filePath: string;
    eventMatchCriteria: string;
    instruction: string;
    active: boolean;
}

const ROUTING_SYSTEM_PROMPT = `You are a routing classifier for a knowledge management system.

You will receive an event (something that happened — an email, meeting, message, etc.) and a list of track blocks. Each track block has:
- trackId: an identifier (only unique within its file)
- filePath: the note file the track lives in
- eventMatchCriteria: a description of what kinds of signals are relevant to this track

Your job is to identify which track blocks MIGHT be relevant to this event.

Rules:
- Be LIBERAL in your selections. Include any track that is even moderately relevant.
- Prefer false positives over false negatives. It is much better to include a track that turns out to be irrelevant than to miss one that was relevant.
- Only exclude tracks that are CLEARLY and OBVIOUSLY irrelevant to the event.
- Do not attempt to judge whether the event contains enough information to update the track. That is handled by a later stage.
- Return an empty list only if no tracks are relevant at all.
- For each candidate, return BOTH trackId and filePath exactly as given. trackIds are not globally unique.`;

async function resolveModel() {
    const { model, provider } = await getDefaultModelAndProvider();
    const config = await resolveProviderConfig(provider);
    return createProvider(config).languageModel(model);
}

function buildRoutingPrompt(event: KnowledgeEvent, batch: ParsedTrack[]): string {
    const trackList = batch
        .map((t, i) => `${i + 1}. trackId: ${t.trackId}\n   filePath: ${t.filePath}\n   eventMatchCriteria: ${t.eventMatchCriteria}`)
        .join('\n\n');

    return `## Event

Source: ${event.source}
Type: ${event.type}
Time: ${event.createdAt}

${event.payload}

## Track Blocks

${trackList}`;
}

function trackKey(trackId: string, filePath: string): string {
    return `${filePath}::${trackId}`;
}

export async function findCandidates(
    event: KnowledgeEvent,
    allTracks: ParsedTrack[],
): Promise<ParsedTrack[]> {
    // Short-circuit for targeted re-runs — skip LLM routing entirely
    if (event.targetTrackId && event.targetFilePath) {
        const target = allTracks.find(t =>
            t.trackId === event.targetTrackId && t.filePath === event.targetFilePath
        );
        return target ? [target] : [];
    }

    const filtered = allTracks.filter(t =>
        t.active && t.instruction && t.eventMatchCriteria
    );
    if (filtered.length === 0) {
        log.log(`No event-eligible tracks (none with eventMatchCriteria)`);
        return [];
    }

    log.log(`Routing event ${event.id} against ${filtered.length} track(s)`);

    const model = await resolveModel();
    const candidateKeys = new Set<string>();

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
        const batch = filtered.slice(i, i + BATCH_SIZE);
        try {
            const { object } = await generateObject({
                model,
                system: ROUTING_SYSTEM_PROMPT,
                prompt: buildRoutingPrompt(event, batch),
                schema: trackBlock.Pass1OutputSchema,
            });
            for (const c of object.candidates) {
                candidateKeys.add(trackKey(c.trackId, c.filePath));
            }
        } catch (err) {
            log.log(`Routing batch ${i / BATCH_SIZE} failed:`, err);
        }
    }

    const candidates = filtered.filter(t => candidateKeys.has(trackKey(t.trackId, t.filePath)));
    log.log(`Event ${event.id}: ${candidates.length} candidate(s) — ${candidates.map(c => `${c.trackId}@${c.filePath}`).join(', ') || '(none)'}`);
    return candidates;
}
