import type { z } from "zod";
import type { AssistantMessage, UserMessage } from "@x/shared/dist/message.js";
import type {
    JsonValue,
    RequestedAgent,
    ToolResultData,
    TurnContext,
    TurnEvent,
    TurnStreamEvent,
    TurnSuspended,
    TurnUsage,
} from "@x/shared/dist/turns.js";

export interface CreateTurnInput {
    agent: z.infer<typeof RequestedAgent>;
    sessionId?: string | null;
    context: z.infer<typeof TurnContext>;
    input: z.infer<typeof UserMessage>;
    config: {
        autoPermission?: boolean;
        humanAvailable: boolean;
        maxModelCalls?: number;
        // Canonical per-turn reasoning effort; omitted = auto (provider
        // default, byte-identical requests to today).
        reasoningEffort?: "low" | "medium" | "high";
    };
}

// Exactly one external input per advanceTurn invocation.
export type TurnExternalInput =
    | {
          type: "permission_decision";
          toolCallId: string;
          decision: "allow" | "deny";
          metadata?: JsonValue;
      }
    | {
          type: "async_tool_progress";
          toolCallId: string;
          progress: JsonValue;
      }
    | {
          type: "async_tool_result";
          toolCallId: string;
          result: z.infer<typeof ToolResultData>;
      }
    | {
          type: "cancel";
          reason?: string;
      };

export type TurnOutcome =
    | {
          status: "completed";
          output: z.infer<typeof AssistantMessage>;
          finishReason: string;
          usage: z.infer<typeof TurnUsage>;
      }
    | {
          status: "suspended";
          pendingPermissions: z.infer<typeof TurnSuspended>["pendingPermissions"];
          pendingAsyncTools: z.infer<typeof TurnSuspended>["pendingAsyncTools"];
          usage: z.infer<typeof TurnUsage>;
      }
    | {
          status: "failed";
          error: string;
          // Mirrors turn_failed.code (e.g. MODEL_CALL_LIMIT_ERROR_CODE).
          code?: string;
          usage: z.infer<typeof TurnUsage>;
      }
    | {
          status: "cancelled";
          reason?: string;
          usage: z.infer<typeof TurnUsage>;
      };

export interface TurnExecution {
    events: AsyncIterable<TurnStreamEvent>;
    outcome: Promise<TurnOutcome>;
}

export interface Turn {
    turnId: string;
    events: Array<z.infer<typeof TurnEvent>>;
}

export interface ITurnRuntime {
    createTurn(input: CreateTurnInput): Promise<string>;
    advanceTurn(
        turnId: string,
        input?: TurnExternalInput,
        options?: { signal?: AbortSignal },
    ): TurnExecution;
    getTurn(turnId: string): Promise<Turn>;
}

// An external input that does not match the turn's current durable pending
// state. Rejects the execution; nothing is appended.
export class TurnInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TurnInputError";
    }
}

// A live runtime dependency is missing or incompatible with the persisted
// snapshot. Rejects the execution; the turn is left unchanged so the caller
// can fix its environment and retry.
export class TurnDependencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TurnDependencyError";
    }
}
