import { z } from "zod";
import {
    ModelDescriptor,
    type TurnStatus,
    type TurnStreamEvent,
} from "./turns.js";

// Durable session contract for the session layer (see
// packages/core/docs/session-design.md). A session is an append-only chain
// of turn references plus presentation metadata; conversation content lives
// exclusively in turn files. Pure module shared by core and renderer.

// ---------------------------------------------------------------------------
// Durable events
// ---------------------------------------------------------------------------

export const SessionCreated = z.object({
    type: z.literal("session_created"),
    schemaVersion: z.literal(1),
    sessionId: z.string(),
    ts: z.string(),
    title: z.string().optional(),
});

// agentId/model are denormalized from the turn so the session index can fold
// without opening turn files; the turn file stays authoritative.
export const SessionTurnAppended = z.object({
    type: z.literal("turn_appended"),
    sessionId: z.string(),
    ts: z.string(),
    turnId: z.string(),
    sessionSeq: z.number().int().positive(),
    agentId: z.string(),
    model: ModelDescriptor,
});

export const SessionTitleChanged = z.object({
    type: z.literal("title_changed"),
    sessionId: z.string(),
    ts: z.string(),
    title: z.string(),
});

export const SessionEvent = z.discriminatedUnion("type", [
    SessionCreated,
    SessionTurnAppended,
    SessionTitleChanged,
]);

// ---------------------------------------------------------------------------
// Derived session state
// ---------------------------------------------------------------------------

export class SessionCorruptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionCorruptionError";
    }
}

export interface SessionTurnRef {
    turnId: string;
    sessionSeq: number;
    agentId: string;
    model: z.infer<typeof ModelDescriptor>;
    ts: string;
}

export interface SessionState {
    definition: z.infer<typeof SessionCreated>;
    title?: string;
    turns: SessionTurnRef[];
    latestTurnId?: string;
    createdAt: string;
    updatedAt: string;
}

function fail(message: string): never {
    throw new SessionCorruptionError(message);
}

export function reduceSession(
    events: Array<z.infer<typeof SessionEvent>>,
): SessionState {
    if (events.length === 0) {
        fail("session log is empty");
    }
    const [first, ...rest] = events;
    if (first.type !== "session_created") {
        fail(`first event must be session_created, got ${first.type}`);
    }
    if (first.schemaVersion !== 1) {
        fail(`unsupported session schema version: ${String(first.schemaVersion)}`);
    }

    const state: SessionState = {
        definition: first,
        title: first.title,
        turns: [],
        createdAt: first.ts,
        updatedAt: first.ts,
    };

    for (const event of rest) {
        if (event.sessionId !== first.sessionId) {
            fail(
                `event sessionId ${event.sessionId} does not match session ${first.sessionId}`,
            );
        }
        switch (event.type) {
            case "session_created":
                fail("duplicate session_created event");
                break;
            case "turn_appended": {
                const expectedSeq = state.turns.length + 1;
                if (event.sessionSeq !== expectedSeq) {
                    fail(
                        `sessionSeq ${event.sessionSeq} out of order; expected ${expectedSeq}`,
                    );
                }
                if (state.turns.some((t) => t.turnId === event.turnId)) {
                    fail(`duplicate turnId in session: ${event.turnId}`);
                }
                state.turns.push({
                    turnId: event.turnId,
                    sessionSeq: event.sessionSeq,
                    agentId: event.agentId,
                    model: event.model,
                    ts: event.ts,
                });
                state.latestTurnId = event.turnId;
                break;
            }
            case "title_changed":
                state.title = event.title;
                break;
            default: {
                const unknown: never = event;
                fail(
                    `unknown session event type: ${(unknown as { type: string }).type}`,
                );
            }
        }
        state.updatedAt = event.ts;
    }

    return state;
}

// ---------------------------------------------------------------------------
// Session index (in-memory projection; never a source of truth)
// ---------------------------------------------------------------------------

// "none" = the session has no turns yet. The remaining values are the latest
// turn's derived status (deriveTurnStatus in turns.ts).
export type SessionLatestTurnStatus = "none" | TurnStatus;

export interface SessionIndexEntry {
    sessionId: string;
    title?: string;
    createdAt: string;
    updatedAt: string;
    turnCount: number;
    lastAgentId?: string;
    lastModel?: z.infer<typeof ModelDescriptor>;
    latestTurnId?: string;
    latestTurnStatus: SessionLatestTurnStatus;
    // Set when the session (or its latest turn) failed to load/validate; the
    // entry is surfaced in an errored state instead of aborting the startup
    // scan.
    error?: string;
}

// What the renderer's single feed consumer receives over IPC: live turn
// stream events (durable events + ephemeral deltas) and index updates.
// entry: null signals deletion.
export type SessionBusEvent =
    | {
          kind: "turn-event";
          sessionId: string;
          turnId: string;
          event: TurnStreamEvent;
      }
    | {
          kind: "index-changed";
          sessionId: string;
          entry: SessionIndexEntry | null;
      };

export function sessionIndexEntry(
    state: SessionState,
    latestTurnStatus: SessionLatestTurnStatus,
): SessionIndexEntry {
    const lastTurn = state.turns[state.turns.length - 1];
    return {
        sessionId: state.definition.sessionId,
        title: state.title,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        turnCount: state.turns.length,
        lastAgentId: lastTurn?.agentId,
        lastModel: lastTurn?.model,
        latestTurnId: state.latestTurnId,
        latestTurnStatus,
    };
}
