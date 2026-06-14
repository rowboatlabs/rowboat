import { z } from "zod";
import { Session } from "./types.js";

// Durable storage for session rows. The per-session mutex lives ABOVE the
// store (in SessionsImpl), not in it.
export interface SessionStore {
    create(session: z.infer<typeof Session>): Promise<void>;
    get(id: string): Promise<z.infer<typeof Session> | null>;
    // Most recently active first (updatedAt descending).
    list(filter?: { agentId?: string }): Promise<z.infer<typeof Session>[]>;
    update(session: z.infer<typeof Session>): Promise<void>;
    delete(id: string): Promise<void>;
}
