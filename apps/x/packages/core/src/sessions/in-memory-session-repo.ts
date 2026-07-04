import { z } from "zod";
import {
    SessionCorruptionError,
    SessionCreated,
    SessionEvent,
} from "@x/shared/dist/sessions.js";
import { KeyedMutex } from "../turns/keyed-mutex.js";
import type { ISessionRepo } from "./repo.js";

// Test fake mirroring FSSessionRepo semantics without touching disk.
export class InMemorySessionRepo implements ISessionRepo {
    private files = new Map<string, Array<z.infer<typeof SessionEvent>>>();
    private corrupt = new Set<string>();
    private mutex = new KeyedMutex();

    async create(event: z.infer<typeof SessionCreated>): Promise<void> {
        const parsed = SessionCreated.parse(event);
        if (this.files.has(parsed.sessionId) || this.corrupt.has(parsed.sessionId)) {
            throw new Error(`session already exists: ${parsed.sessionId}`);
        }
        this.files.set(parsed.sessionId, [structuredClone(parsed)]);
    }

    async read(sessionId: string): Promise<Array<z.infer<typeof SessionEvent>>> {
        if (this.corrupt.has(sessionId)) {
            throw new SessionCorruptionError(`session file is corrupt: ${sessionId}`);
        }
        const events = this.files.get(sessionId);
        if (!events) {
            throw new Error(`session not found: ${sessionId}`);
        }
        return structuredClone(events);
    }

    async append(
        sessionId: string,
        events: Array<z.infer<typeof SessionEvent>>,
    ): Promise<void> {
        const file = this.files.get(sessionId);
        if (!file) {
            throw new Error(`session not found: ${sessionId}`);
        }
        for (const event of events) {
            const parsed = SessionEvent.parse(event);
            if (parsed.sessionId !== sessionId) {
                throw new Error(
                    `event sessionId ${parsed.sessionId} does not match ${sessionId}`,
                );
            }
            file.push(structuredClone(parsed));
        }
    }

    async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
        return this.mutex.run(sessionId, fn);
    }

    async listSessionIds(): Promise<string[]> {
        return [...this.files.keys(), ...this.corrupt].sort();
    }

    async delete(sessionId: string): Promise<void> {
        const existed = this.files.delete(sessionId) || this.corrupt.delete(sessionId);
        if (!existed) {
            throw new Error(`session not found: ${sessionId}`);
        }
    }

    // Test helpers
    seed(events: Array<z.infer<typeof SessionEvent>>): void {
        if (events.length === 0) {
            throw new Error("cannot seed an empty log");
        }
        this.files.set(
            events[0].sessionId,
            events.map((e) => structuredClone(SessionEvent.parse(e))),
        );
    }

    seedCorrupt(sessionId: string): void {
        this.corrupt.add(sessionId);
    }
}
