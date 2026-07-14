import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
    TurnCorruptionError,
    TurnCreated,
    TurnEvent,
} from "@x/shared/dist/turns.js";
import { KeyedMutex } from "./keyed-mutex.js";
import type { ITurnRepo } from "./repo.js";

// Turn IDs come from IMonotonicallyIncreasingIdGenerator and look like
// 2025-11-11T04-36-29Z-0001234-000. The repo validates the format before
// deriving a path and rejects anything path-like.
const TURN_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T[A-Za-z0-9-]+$/;

export class FSTurnRepo implements ITurnRepo {
    private readonly rootDir: string;
    private readonly mutex = new KeyedMutex();

    constructor({ turnsRootDir }: { turnsRootDir: string }) {
        this.rootDir = turnsRootDir;
    }

    private filePath(turnId: string): string {
        const match = TURN_ID_PATTERN.exec(turnId);
        if (!match) {
            throw new Error(`invalid turn id: ${turnId}`);
        }
        const [, year, month, day] = match;
        return path.join(this.rootDir, year, month, day, `${turnId}.jsonl`);
    }

    private serialize(
        turnId: string,
        events: Array<z.infer<typeof TurnEvent>>,
    ): string {
        let payload = "";
        for (const event of events) {
            const parsed = TurnEvent.parse(event);
            if (parsed.turnId !== turnId) {
                throw new Error(
                    `event turnId ${parsed.turnId} does not match ${turnId}`,
                );
            }
            payload += `${JSON.stringify(parsed)}\n`;
        }
        return payload;
    }

    async create(event: z.infer<typeof TurnCreated>): Promise<void> {
        const parsed = TurnCreated.parse(event);
        const file = this.filePath(parsed.turnId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        // "wx" fails if the file already exists.
        await fs.writeFile(file, this.serialize(parsed.turnId, [parsed]), {
            flag: "wx",
        });
    }

    async read(turnId: string): Promise<Array<z.infer<typeof TurnEvent>>> {
        const file = this.filePath(turnId);
        let raw: string;
        try {
            raw = await fs.readFile(file, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error(`turn not found: ${turnId}`);
            }
            throw error;
        }
        if (raw.length === 0) {
            throw new TurnCorruptionError(`turn file is empty: ${turnId}`);
        }
        const lines = raw.split("\n");
        // A well-formed file ends with a newline, leaving one trailing empty
        // segment. Anything else (including a torn final line) is corrupt.
        const trailing = lines.pop();
        if (trailing !== "") {
            throw new TurnCorruptionError(
                `turn file does not end with a complete line: ${turnId}`,
            );
        }
        const events: Array<z.infer<typeof TurnEvent>> = [];
        for (const [index, line] of lines.entries()) {
            let parsed: z.infer<typeof TurnEvent>;
            try {
                parsed = TurnEvent.parse(JSON.parse(line));
            } catch (error) {
                throw new TurnCorruptionError(
                    `malformed turn event at ${turnId}:${index + 1}: ${String(
                        error instanceof Error ? error.message : error,
                    )}`,
                );
            }
            if (parsed.turnId !== turnId) {
                throw new TurnCorruptionError(
                    `event turnId ${parsed.turnId} does not match file ${turnId}`,
                );
            }
            events.push(parsed);
        }
        return events;
    }

    async append(
        turnId: string,
        events: Array<z.infer<typeof TurnEvent>>,
    ): Promise<void> {
        if (events.length === 0) {
            return;
        }
        const payload = this.serialize(turnId, events);
        const file = this.filePath(turnId);
        // Appends must never create a file: a turn exists only via create().
        // All writers hold the per-turn lock, so check-then-append is safe.
        try {
            await fs.access(file);
        } catch {
            throw new Error(`turn not found: ${turnId}`);
        }
        await fs.appendFile(file, payload);
    }

    async withLock<T>(turnId: string, fn: () => Promise<T>): Promise<T> {
        return this.mutex.run(turnId, fn);
    }
}
