import { z } from "zod";
import type { SessionStore } from "./session-store.js";
import { Session } from "./types.js";

export class InMemorySessionStore implements SessionStore {
    private sessions = new Map<string, z.infer<typeof Session>>();

    async create(session: z.infer<typeof Session>): Promise<void> {
        if (this.sessions.has(session.id)) {
            throw new Error(`Session already exists: ${session.id}`);
        }
        this.sessions.set(session.id, structuredClone(session));
    }

    async get(id: string): Promise<z.infer<typeof Session> | null> {
        const session = this.sessions.get(id);
        return session ? structuredClone(session) : null;
    }

    async list(filter?: { agentId?: string }): Promise<z.infer<typeof Session>[]> {
        return [...this.sessions.values()]
            .filter((s) => filter?.agentId === undefined || s.agentId === filter.agentId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((s) => structuredClone(s));
    }

    async update(session: z.infer<typeof Session>): Promise<void> {
        if (!this.sessions.has(session.id)) {
            throw new Error(`Session not found: ${session.id}`);
        }
        this.sessions.set(session.id, structuredClone(session));
    }
}
