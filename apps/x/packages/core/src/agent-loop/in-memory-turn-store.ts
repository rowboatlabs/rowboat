import { z } from "zod";
import { AgentLoopTurn } from "./types.js";
import type { TurnStore } from "./turn-store.js";

export class InMemoryTurnStore implements TurnStore {
    private turns = new Map<string, z.infer<typeof AgentLoopTurn>>();

    async create(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        if (this.turns.has(turn.id)) {
            throw new Error(`Turn already exists: ${turn.id}`);
        }
        this.turns.set(turn.id, structuredClone(turn));
    }

    async get(id: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const turn = this.turns.get(id);
        return turn ? structuredClone(turn) : null;
    }

    async update(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        if (!this.turns.has(turn.id)) {
            throw new Error(`Turn not found: ${turn.id}`);
        }
        this.turns.set(turn.id, structuredClone(turn));
    }
}
