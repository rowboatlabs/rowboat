import { z } from "zod";
import { AgentLoopTurn } from "./types.js";
import type { TurnStore } from "./turn-store.js";

export class InMemoryTurnStore implements TurnStore {
    private turns = new Map<string, z.infer<typeof AgentLoopTurn>>();

    async create(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        if (this.turns.has(turn.id)) {
            throw new Error(`Turn already exists: ${turn.id}`);
        }
        // Mirror the SQLite UNIQUE(session_id, session_seq) tripwire — NULL
        // seqs never conflict, matching SQLite's distinct-NULLs semantics.
        if (turn.sessionId !== null && turn.sessionSeq !== null) {
            for (const existing of this.turns.values()) {
                if (existing.sessionId === turn.sessionId && existing.sessionSeq === turn.sessionSeq) {
                    throw new Error(
                        `Turn with session seq already exists: ${turn.sessionId}#${turn.sessionSeq}`,
                    );
                }
            }
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

    async latestForSession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const turns = await this.listBySession(sessionId);
        return turns.length > 0 ? turns[turns.length - 1] : null;
    }

    async listBySession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]> {
        return [...this.turns.values()]
            .filter((turn) => turn.sessionId === sessionId)
            .sort((a, b) => (a.sessionSeq ?? 0) - (b.sessionSeq ?? 0))
            .map((turn) => structuredClone(turn));
    }
}
