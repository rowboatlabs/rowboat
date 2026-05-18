import type { RowboatEvent } from '@x/shared/dist/events.js';

/**
 * A target (live note, bg-task, …) that a consumer might fire on an event.
 * The `id` is consumer-defined — a workspace-relative path for live-note, a
 * slug for bg-task. The processor never interprets it.
 */
export interface EventConsumerTarget {
    id: string;
    instructions: string;
    eventMatchCriteria: string;
}

export interface EventConsumerFireResult {
    runId: string | null;
    error?: string;
}

/**
 * An event consumer registers itself with the event processor in `init.ts`.
 * On each pending event, the processor runs all consumers' `findCandidates`
 * concurrently (Pass-1 routing), then fires each consumer's candidates
 * sequentially (preserves per-target FIFO) while consumers run in parallel.
 */
export interface EventConsumer {
    /** Stable identifier for logging and the enriched event `consumers` map. */
    name: string;

    /** All eligible candidates this consumer would consider routing into. */
    listEligibleTargets(): Promise<EventConsumerTarget[]>;

    /**
     * Pass-1 routing. The implementation usually short-circuits when
     * `event.target?.consumer === this.name`, otherwise delegates to
     * `routeBatch` from `./routing.js`.
     */
    findCandidates(event: RowboatEvent, targets: EventConsumerTarget[]): Promise<string[]>;

    /** Fire the consumer's agent on a single candidate id. */
    fireCandidate(event: RowboatEvent, id: string): Promise<EventConsumerFireResult>;
}
