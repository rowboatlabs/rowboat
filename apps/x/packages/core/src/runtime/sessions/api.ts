import type { z } from "zod";
import type { UseCase } from "@x/shared/dist/analytics.js";
import type { UserMessage } from "@x/shared/dist/message.js";
import type { InputOrigin, SessionOrigin } from "@x/shared/dist/origins.js";
import type {
    QueuedSessionMessage,
    SessionIndexEntry,
    SessionState,
} from "@x/shared/dist/sessions.js";
import type {
    JsonValue,
    RequestedAgent,
    ToolResultData,
} from "@x/shared/dist/turns.js";
import type { Turn } from "../turns/api.js";

/**
 * The cancel reason sendOrQueueMessage records when it reclaims a
 * crash-orphaned turn (idle in the log, no live advance — nothing will ever
 * settle it). Consumers that narrate turn endings can match on it to tell a
 * reclaim apart from a person pressing Stop.
 */
export const RECLAIMED_TURN_REASON =
    "interrupted: the app quit or crashed while this turn was running";

// Per-message configuration; it lands on the turn (sessions store none).
export interface SendMessageConfig {
    agent: z.infer<typeof RequestedAgent>;
    useCase?: UseCase;
    subUseCase?: string;
    autoPermission?: boolean;
    // Default true (a chat has a human). Autonomous senders (background code
    // tasks) pass false so the turn never suspends waiting for an answer
    // that can't come — ask-human is unavailable and gated tools auto-deny.
    humanAvailable?: boolean;
    maxModelCalls?: number;
    reasoningEffort?: "low" | "medium" | "high";
    // What outside the runtime caused this message (a space mention, ...).
    // Lands on turn_created when the message starts a turn, on input_added
    // when it is steered into a live one; a queued entry carries it until
    // then. Recorded, never read, by the runtime — see @x/shared origins.
    origin?: InputOrigin;
}

export interface ISessions {
    // Startup scan: builds the in-memory index from session files (reading
    // each session's latest turn for status). Must run before listSessions.
    initialize(): Promise<void>;

    // origin: what owns the session when something outside the runtime
    // does (a space thread). Main-process callers only — the renderer's
    // sessions:create contract deliberately accepts title alone.
    createSession(input?: { title?: string; origin?: SessionOrigin }): Promise<string>;
    /** Preserve the original and submit a revised prompt with only its preceding history. */
    editMessage(sessionId: string, turnId: string, text: string): Promise<{ sessionId: string; turnId: string }>;
    listSessions(): SessionIndexEntry[];
    getSession(sessionId: string): Promise<SessionState>;
    getTurn(turnId: string): Promise<Turn>;

    // Rejects with TurnNotSettledError while the latest turn is non-terminal.
    // Returns as soon as the turn is created, referenced, and advancing;
    // progress flows through the bus. Programmatic callers that need the
    // strict "no implicit queueing" contract use this; the chat UI uses
    // sendOrQueueMessage.
    sendMessage(
        sessionId: string,
        input: z.infer<typeof UserMessage>,
        config: SendMessageConfig,
    ): Promise<{ turnId: string }>;

    // Deliver-ASAP: starts a turn immediately when the session is settled,
    // otherwise accepts the message into the ephemeral pending queue. Queued
    // messages steer the live turn at its next model-call boundary (durable
    // input_added events), or — if the turn settles first — promote FIFO into
    // a new turn; either way the message reaches the model at the earliest
    // safe point. The queue is process memory only: a crash drops it together
    // with the turn it was steering.
    sendOrQueueMessage(
        sessionId: string,
        input: z.infer<typeof UserMessage>,
        config: SendMessageConfig,
    ): Promise<SendOrQueueOutcome>;

    // Pending-queue introspection and pre-delivery editing. All are
    // process-memory operations; queue-changed bus events mirror every
    // mutation to the renderer.
    listQueued(sessionId: string): QueuedSessionMessage[];
    editQueued(
        sessionId: string,
        queueId: string,
        message: z.infer<typeof UserMessage>,
    ): void;
    removeQueued(
        sessionId: string,
        queueId: string,
    ): QueuedSessionMessage | undefined;

    // External inputs, one advanceTurn each. These settle with that
    // invocation's outcome; turn-runtime input rejections pass through.
    respondToPermission(
        turnId: string,
        toolCallId: string,
        decision: "allow" | "deny",
        metadata?: JsonValue,
    ): Promise<void>;
    // The dedicated ask-human endpoint; sendMessage never routes here.
    respondToAskHuman(
        turnId: string,
        toolCallId: string,
        answer: string,
    ): Promise<void>;
    deliverAsyncToolResult(
        turnId: string,
        toolCallId: string,
        result: z.infer<typeof ToolResultData>,
    ): Promise<void>;

    // Stopping also drains the session's pending queue — a stop must not be
    // followed by a queued message auto-starting work — and returns the
    // drained messages so the UI can restore their text to the composer.
    stopTurn(
        turnId: string,
        reason?: string,
    ): Promise<{ dequeued: QueuedSessionMessage[] }>;
    // Recovery entry for turns left idle by a crash; runs in the background.
    resumeTurn(sessionId: string): Promise<void>;

    setTitle(sessionId: string, title: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
}

export type SendOrQueueOutcome =
    | { queued: false; turnId: string }
    | { queued: true; queueId: string };

export class TurnNotSettledError extends Error {
    constructor(
        readonly sessionId: string,
        readonly turnId: string,
        readonly turnStatus: string,
    ) {
        super(
            `session ${sessionId} has a non-terminal turn ${turnId} (${turnStatus})`,
        );
        this.name = "TurnNotSettledError";
    }
}
