import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { events, PrefixLogger } from '@x/shared';
import type { RowboatEvent } from '@x/shared/dist/events.js';
import { captureLlmUsage } from '../analytics/usage.js';
import type { UseCase } from '../analytics/use_case.js';
import type { EventConsumerTarget } from './consumer.js';

const log = new PrefixLogger('Events:Routing');

const BATCH_SIZE = 20;

/**
 * Pass-1 LLM classifier — given an event and a list of candidate targets,
 * return the subset whose intent/matchCriteria suggest the event might be
 * relevant. Liberal by design: the consumer's agent does Pass-2 on the event
 * payload before acting.
 */
export interface RouteBatchOptions {
    /** Singular noun for prompt wording, e.g. 'live note', 'background task'. */
    entitySingular: string;
    /** Plural noun for prompt wording, e.g. 'live notes', 'background tasks'. */
    entityPlural: string;
    /** Analytics use case (e.g. 'live_note_agent', 'background_task_agent'). */
    useCase: UseCase;
    /** Resolver returning the LLM to use for routing. Each consumer provides its own
     *  so model selection stays aligned with the consumer's agent model. */
    resolveModel: () => Promise<{ model: LanguageModel; modelId: string; providerName: string }>;
}

function buildSystemPrompt(opts: Pick<RouteBatchOptions, 'entitySingular' | 'entityPlural'>): string {
    const { entitySingular, entityPlural } = opts;
    return `You are a routing classifier for a personal productivity workspace.

You will receive an event (something that happened — an email, meeting, message, etc.) and a list of ${entityPlural}. Each one has:
- id: an identifier you return in the output
- intent: the persistent intent of the ${entitySingular} (what it should keep being / containing / doing)
- matchCriteria: an explicit description of which kinds of incoming signals should wake this ${entitySingular}

Your job is to identify which ${entityPlural} MIGHT be relevant to this event.

Rules:
- Be LIBERAL in your selections. Include any ${entitySingular} that is even moderately relevant.
- Prefer false positives over false negatives — it is much better to include one that turns out to be irrelevant than to miss one that was relevant.
- Only exclude entries that are CLEARLY and OBVIOUSLY irrelevant to the event.
- Do not attempt to judge whether the event contains enough information to act on. That is handled by the agent in a later stage.
- Return an empty list only if no entries are relevant at all.
- Return each candidate's id exactly as given.`;
}

function buildPrompt(event: RowboatEvent, batch: EventConsumerTarget[], entityPlural: string): string {
    const list = batch
        .map((t, i) => `${i + 1}. id: ${t.id}\n   intent: ${t.instructions}\n   matchCriteria: ${t.eventMatchCriteria}`)
        .join('\n\n');

    return `## Event

Source: ${event.source}
Type: ${event.type}
Time: ${event.createdAt}

${event.payload}

## ${entityPlural[0].toUpperCase()}${entityPlural.slice(1)}

${list}`;
}

/**
 * Run Pass-1 routing for one consumer. Returns the subset of `targets` whose
 * ids the classifier flagged as relevant. Batched in groups of 20.
 */
export async function routeBatch(
    event: RowboatEvent,
    targets: EventConsumerTarget[],
    opts: RouteBatchOptions,
): Promise<string[]> {
    if (targets.length === 0) {
        log.log(`event:${event.id} — no eligible ${opts.entityPlural}`);
        return [];
    }

    log.log(`event:${event.id} — routing against ${targets.length} ${targets.length === 1 ? opts.entitySingular : opts.entityPlural}`);

    const { model, modelId, providerName } = await opts.resolveModel();
    const systemPrompt = buildSystemPrompt(opts);
    const matched = new Set<string>();

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        try {
            const result = await generateObject({
                model,
                system: systemPrompt,
                prompt: buildPrompt(event, batch, opts.entityPlural),
                schema: events.Pass1OutputSchema,
            });
            captureLlmUsage({
                useCase: opts.useCase,
                subUseCase: 'routing',
                model: modelId,
                provider: providerName,
                usage: result.usage,
            });
            for (const id of result.object.ids) {
                matched.add(id);
            }
        } catch (err) {
            log.log(`event:${event.id} — Pass1 batch ${Math.floor(i / BATCH_SIZE)} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const candidateIds = targets.filter(t => matched.has(t.id)).map(t => t.id);
    log.log(`event:${event.id} — Pass1 → ${candidateIds.length} candidate${candidateIds.length === 1 ? '' : 's'}${candidateIds.length > 0 ? `: ${candidateIds.join(', ')}` : ''}`);
    return candidateIds;
}
