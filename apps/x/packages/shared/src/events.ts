import { z } from 'zod';

// ---------------------------------------------------------------------------
// Rowboat events — the shared queue feeding the live-note + bg-task consumers.
//
// Producers (gmail/calendar sync) write JSON files to `$WorkDir/events/pending/`
// using IDs from the monotonically increasing ID generator. The processor in
// `packages/core/src/events/processor.ts` polls the directory, fans out Pass-1
// routing across registered consumers in parallel, fires each consumer's
// candidates sequentially, then enriches the event and moves it to `done/`.
//
// Schema is additive-on-optional so old events written by previous versions
// parse cleanly. The legacy `KnowledgeEventSchema` is re-exported as an alias
// from `./live-note.ts` for one release.
// ---------------------------------------------------------------------------

export const ConsumerResultSchema = z.object({
    candidateIds: z.array(z.string()),
    runIds: z.array(z.string()),
    errors: z.array(z.string()).optional(),
});

export type ConsumerResult = z.infer<typeof ConsumerResultSchema>;

export const RowboatEventSchema = z.object({
    id: z.string().describe('Monotonically increasing ID; also the filename in events/pending/'),
    source: z.string().describe('Producer of the event (e.g. "gmail", "calendar")'),
    type: z.string().describe('Event type (e.g. "email.synced")'),
    createdAt: z.string().describe('ISO timestamp when the event was produced'),
    payload: z.string().describe('Human-readable event body, usually markdown'),

    /**
     * If set, the consumer-named here short-circuits Pass-1 and targets the
     * named id directly (used for re-runs from the UI). The producer is
     * unchanged from the legacy `targetFilePath` behavior but generalized.
     */
    target: z.object({
        consumer: z.string(),
        id: z.string(),
    }).optional(),

    /** Legacy field — preserved on read for backwards compat with events
     *  written by the pre-rename code. Equivalent to
     *  `target: { consumer: 'live-note', id: <value> }`. */
    targetFilePath: z.string().optional(),

    // ----------------- Enriched on move from pending/ to done/ -----------

    processedAt: z.string().optional(),

    /** Per-consumer outcome map. */
    consumers: z.record(z.string(), ConsumerResultSchema).optional(),

    /** Legacy field — preserved on read for backwards compat with events
     *  enriched by the pre-rename code. */
    candidateFilePaths: z.array(z.string()).optional(),

    /** Legacy field — preserved on read for backwards compat with events
     *  enriched by the pre-rename code. */
    runIds: z.array(z.string()).optional(),

    error: z.string().optional(),
});

export type RowboatEvent = z.infer<typeof RowboatEventSchema>;

/**
 * Pass-1 routing output. The `ids` strings are consumer-defined:
 * - live-note → workspace-relative paths
 * - bg-task → task slugs
 */
export const Pass1OutputSchema = z.object({
    ids: z.array(z.string()).describe('Identifiers of candidates whose intent and event-match criteria suggest the event might be relevant. The consumer\'s agent does Pass 2 on the event payload before acting.'),
});

export type Pass1Output = z.infer<typeof Pass1OutputSchema>;
