import { z } from "zod";
import { Message } from "@x/shared/dist/message.js";
import { AgentLoopTurn, closedTranscript } from "./types.js";

// Transcript prefix dedup, shared by the turn stores.
//
// A session turn's input begins with the previous turn's closed transcript
// (copy-forward history). Storing that prefix again in every turn makes
// session storage quadratic and rewrites the whole transcript on every fact
// append. Instead, stores keep only the suffix the turn adds, plus the prefix
// LENGTH; on read, the prefix is recomputed from the (immutable, terminal)
// previous turn via closedTranscript and re-attached.
//
// The dedup is OPPORTUNISTIC: if a turn's messages do not start with exactly
// the previous turn's closed transcript (e.g. a future compaction feature
// sends a summary instead), the full messages are stored and nothing breaks.
// Callers above the store never see any of this — turns read back whole.

export type SplitTranscript = {
    prefixLength: number;
    delta: z.infer<typeof Message>[];
};

// prev is the MATERIALIZED previous session turn (seq - 1), or null if there
// is none. Returns the storable suffix; prefixLength 0 means "stored whole".
export function splitTranscript(
    turn: z.infer<typeof AgentLoopTurn>,
    prev: z.infer<typeof AgentLoopTurn> | null,
): SplitTranscript {
    if (prev === null) return { prefixLength: 0, delta: turn.messages };
    const closed = closedTranscript(prev);
    if (closed.length === 0 || closed.length > turn.messages.length) {
        return { prefixLength: 0, delta: turn.messages };
    }
    const head = turn.messages.slice(0, closed.length);
    if (JSON.stringify(head) !== JSON.stringify(closed)) {
        return { prefixLength: 0, delta: turn.messages };
    }
    return { prefixLength: closed.length, delta: turn.messages.slice(closed.length) };
}

// Inverse of splitTranscript. prev must be the materialized previous session
// turn whenever prefixLength > 0 — its absence means the chain is broken
// (a deleted or missing predecessor), which must fail loudly, never return a
// transcript with a silently missing prefix.
export function joinTranscript(
    turnId: string,
    prev: z.infer<typeof AgentLoopTurn> | null,
    prefixLength: number,
    delta: z.infer<typeof Message>[],
): z.infer<typeof Message>[] {
    if (prefixLength === 0) return delta;
    if (prev === null) {
        throw new Error(`Turn ${turnId} requires its previous session turn to materialize`);
    }
    const closed = closedTranscript(prev);
    if (closed.length !== prefixLength) {
        throw new Error(
            `Transcript prefix mismatch for turn ${turnId}: stored ${prefixLength}, derived ${closed.length}`,
        );
    }
    return [...closed, ...delta];
}
