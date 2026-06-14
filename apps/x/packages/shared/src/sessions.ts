import { z } from "zod";
import { CodeMode, MiddlePaneContext, VoiceOutputMode } from "./message.js";
import { AgentLoopTurn, PermissionMode, type TurnEvent } from "./agent-turn.js";

// A session is a grouping label plus a title — an ordered chain of turns,
// linked via the turn's sessionId/sessionSeq. All configuration (provider,
// model, permission mode) flows through sendMessage at the moment it is used
// and lands on the turn row as the durable record; the session deliberately
// stores none of it. agentId is the exception: a session is a conversation
// WITH an agent, and "list sessions for agent X" is a session-level query.
export const Session = z.object({
    id: z.string(),
    agentId: z.string().nullable(),
    title: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const CreateSessionInput = z.object({
    agentId: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
});

export const SendMessageOptions = z.object({
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    permissionMode: PermissionMode.optional(),
    // Analytics attribution. Defaults to "copilot_chat" in the sessions layer
    // (sessions are the chat surface) when omitted.
    useCase: z.string().optional(),
    subUseCase: z.string().optional(),
    // Per-message compose chips. voice/search/codeMode shape the turn's system
    // prompt (stored as the turn's composeContext); middlePaneContext + a fresh
    // datetime ride on the user message itself.
    voiceInput: z.boolean().optional(),
    voiceOutput: VoiceOutputMode.optional(),
    searchEnabled: z.boolean().optional(),
    codeMode: CodeMode.optional(),
    middlePaneContext: MiddlePaneContext.optional(),
});

// What the renderer's single feed consumer receives: live deltas (`event`) and
// committed state snapshots (`state`). Both carry turnId + sessionId so the
// useAgentTurn / useAgentSession hooks can filter.
export type SessionBusEvent =
    | { kind: "event"; turnId: string; sessionId: string | null; event: TurnEvent }
    | { kind: "state"; turnId: string; sessionId: string | null; turn: z.infer<typeof AgentLoopTurn> };
