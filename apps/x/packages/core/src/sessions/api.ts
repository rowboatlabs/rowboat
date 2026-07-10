import type { z } from "zod";
import type { UserMessage } from "@x/shared/dist/message.js";
import type {
    SessionIndexEntry,
    SessionState,
} from "@x/shared/dist/sessions.js";
import type {
    JsonValue,
    RequestedAgent,
    ToolResultData,
} from "@x/shared/dist/turns.js";
import type { Turn } from "../turns/api.js";

// Per-message configuration; it lands on the turn (sessions store none).
export interface SendMessageConfig {
    agent: z.infer<typeof RequestedAgent>;
    autoPermission?: boolean;
    maxModelCalls?: number;
    reasoningEffort?: "low" | "medium" | "high";
}

export interface ISessions {
    // Startup scan: builds the in-memory index from session files (reading
    // each session's latest turn for status). Must run before listSessions.
    initialize(): Promise<void>;

    createSession(input?: { title?: string }): Promise<string>;
    listSessions(): SessionIndexEntry[];
    getSession(sessionId: string): Promise<SessionState>;
    getTurn(turnId: string): Promise<Turn>;

    // Rejects with TurnNotSettledError while the latest turn is non-terminal.
    // Returns as soon as the turn is created, referenced, and advancing;
    // progress flows through the bus.
    sendMessage(
        sessionId: string,
        input: z.infer<typeof UserMessage>,
        config: SendMessageConfig,
    ): Promise<{ turnId: string }>;

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

    stopTurn(turnId: string, reason?: string): Promise<void>;
    // Recovery entry for turns left idle by a crash; runs in the background.
    resumeTurn(sessionId: string): Promise<void>;

    setTitle(sessionId: string, title: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
}

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
