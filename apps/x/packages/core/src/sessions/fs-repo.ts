import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
    SessionCorruptionError,
    SessionCreated,
    SessionEvent,
} from "@x/shared/dist/sessions.js";
import { KeyedMutex } from "../turns/keyed-mutex.js";
import type { ISessionRepo } from "./repo.js";

// Session IDs come from the same generator as turn IDs.
const SESSION_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T[A-Za-z0-9-]+$/;

export class FSSessionRepo implements ISessionRepo {
    private readonly rootDir: string;
    private readonly mutex = new KeyedMutex();

    constructor({ sessionsRootDir }: { sessionsRootDir: string }) {
        this.rootDir = sessionsRootDir;
    }

    private filePath(sessionId: string): string {
        const match = SESSION_ID_PATTERN.exec(sessionId);
        if (!match) {
            throw new Error(`invalid session id: ${sessionId}`);
        }
        const [, year, month, day] = match;
        return path.join(this.rootDir, year, month, day, `${sessionId}.jsonl`);
    }

    private serialize(
        sessionId: string,
        events: Array<z.infer<typeof SessionEvent>>,
    ): string {
        let payload = "";
        for (const event of events) {
            const parsed = SessionEvent.parse(event);
            if (parsed.sessionId !== sessionId) {
                throw new Error(
                    `event sessionId ${parsed.sessionId} does not match ${sessionId}`,
                );
            }
            payload += `${JSON.stringify(parsed)}\n`;
        }
        return payload;
    }

    async create(event: z.infer<typeof SessionCreated>): Promise<void> {
        const parsed = SessionCreated.parse(event);
        const file = this.filePath(parsed.sessionId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, this.serialize(parsed.sessionId, [parsed]), {
            flag: "wx",
        });
    }

    async read(sessionId: string): Promise<Array<z.infer<typeof SessionEvent>>> {
        const file = this.filePath(sessionId);
        let raw: string;
        try {
            raw = await fs.readFile(file, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error(`session not found: ${sessionId}`);
            }
            throw error;
        }
        if (raw.length === 0) {
            throw new SessionCorruptionError(`session file is empty: ${sessionId}`);
        }
        const lines = raw.split("\n");
        const trailing = lines.pop();
        if (trailing !== "") {
            throw new SessionCorruptionError(
                `session file does not end with a complete line: ${sessionId}`,
            );
        }
        const events: Array<z.infer<typeof SessionEvent>> = [];
        for (const [index, line] of lines.entries()) {
            let parsed: z.infer<typeof SessionEvent>;
            try {
                parsed = SessionEvent.parse(JSON.parse(line));
            } catch (error) {
                throw new SessionCorruptionError(
                    `malformed session event at ${sessionId}:${index + 1}: ${String(
                        error instanceof Error ? error.message : error,
                    )}`,
                );
            }
            if (parsed.sessionId !== sessionId) {
                throw new SessionCorruptionError(
                    `event sessionId ${parsed.sessionId} does not match file ${sessionId}`,
                );
            }
            events.push(parsed);
        }
        return events;
    }

    async append(
        sessionId: string,
        events: Array<z.infer<typeof SessionEvent>>,
    ): Promise<void> {
        if (events.length === 0) {
            return;
        }
        const payload = this.serialize(sessionId, events);
        const file = this.filePath(sessionId);
        try {
            await fs.access(file);
        } catch {
            throw new Error(`session not found: ${sessionId}`);
        }
        await fs.appendFile(file, payload);
    }

    async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
        return this.mutex.run(sessionId, fn);
    }

    async listSessionIds(): Promise<string[]> {
        let names: string[];
        try {
            names = (await fs.readdir(this.rootDir, { recursive: true })) as string[];
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return [];
            }
            throw error;
        }
        return names
            .filter((name) => name.endsWith(".jsonl"))
            .map((name) => path.basename(name, ".jsonl"))
            .sort();
    }

    async delete(sessionId: string): Promise<void> {
        const file = this.filePath(sessionId);
        try {
            await fs.unlink(file);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error(`session not found: ${sessionId}`);
            }
            throw error;
        }
    }
}
