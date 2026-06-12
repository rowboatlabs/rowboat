import { z } from "zod";
import { PermissionMode } from "../agent-loop/types.js";

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
});
