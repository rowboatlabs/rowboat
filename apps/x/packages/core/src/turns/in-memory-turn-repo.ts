import { z } from "zod";
import { TurnCreated, TurnEvent } from "@x/shared/dist/turns.js";
import { KeyedMutex } from "./keyed-mutex.js";
import type { ITurnRepo } from "./repo.js";

// Test fake mirroring FSTurnRepo semantics (create-if-absent, validate on
// write and read boundaries, per-turn locking) without touching disk.
export class InMemoryTurnRepo implements ITurnRepo {
    private files = new Map<string, Array<z.infer<typeof TurnEvent>>>();
    private mutex = new KeyedMutex();

    async create(event: z.infer<typeof TurnCreated>): Promise<void> {
        const parsed = TurnCreated.parse(event);
        if (this.files.has(parsed.turnId)) {
            throw new Error(`turn already exists: ${parsed.turnId}`);
        }
        this.files.set(parsed.turnId, [structuredClone(parsed)]);
    }

    async read(turnId: string): Promise<Array<z.infer<typeof TurnEvent>>> {
        const events = this.files.get(turnId);
        if (!events) {
            throw new Error(`turn not found: ${turnId}`);
        }
        return structuredClone(events);
    }

    async append(
        turnId: string,
        events: Array<z.infer<typeof TurnEvent>>,
    ): Promise<void> {
        const file = this.files.get(turnId);
        if (!file) {
            throw new Error(`turn not found: ${turnId}`);
        }
        for (const event of events) {
            const parsed = TurnEvent.parse(event);
            if (parsed.turnId !== turnId) {
                throw new Error(
                    `event turnId ${parsed.turnId} does not match ${turnId}`,
                );
            }
            file.push(structuredClone(parsed));
        }
    }

    async withLock<T>(turnId: string, fn: () => Promise<T>): Promise<T> {
        return this.mutex.run(turnId, fn);
    }

    // Test helper: seed a raw event log (validated) for recovery scenarios.
    seed(events: Array<z.infer<typeof TurnEvent>>): void {
        if (events.length === 0) {
            throw new Error("cannot seed an empty log");
        }
        const turnId = events[0].turnId;
        this.files.set(
            turnId,
            events.map((e) => structuredClone(TurnEvent.parse(e))),
        );
    }
}
