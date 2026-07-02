import type { z } from "zod";
import type { UserMessage } from "@x/shared/dist/message.js";
import type {
    ConversationMessage,
    RequestedAgent,
} from "@x/shared/dist/turns.js";
import type { ITurnRuntime, TurnOutcome } from "../turns/api.js";

// Standalone turns for non-session callers (background tasks, live notes,
// knowledge pipelines, scheduled agents): sessionId null, automatic
// permissions, no human. Never appears in the session index; callers keep
// the turnId if they need history.
export async function runHeadlessTurn(
    turnRuntime: ITurnRuntime,
    input: {
        agent: z.infer<typeof RequestedAgent>;
        context?: Array<z.infer<typeof ConversationMessage>>;
        input: z.infer<typeof UserMessage>;
        maxModelCalls?: number;
        signal?: AbortSignal;
    },
): Promise<{ turnId: string; outcome: TurnOutcome }> {
    const turnId = await turnRuntime.createTurn({
        agent: input.agent,
        sessionId: null,
        context: input.context ?? [],
        input: input.input,
        config: {
            autoPermission: true,
            humanAvailable: false,
            ...(input.maxModelCalls === undefined
                ? {}
                : { maxModelCalls: input.maxModelCalls }),
        },
    });
    const execution = turnRuntime.advanceTurn(turnId, undefined, {
        signal: input.signal,
    });
    const outcome = await execution.outcome;
    return { turnId, outcome };
}
