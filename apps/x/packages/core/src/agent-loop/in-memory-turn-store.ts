import { z } from "zod";
import { AgentLoopTurn } from "./types.js";
import { joinTranscript, splitTranscript } from "./prefix-dedup.js";
import type { TurnStore } from "./turn-store.js";

type StoredTurn = {
    // turn with `messages` holding only the delta past prefixLength
    turn: z.infer<typeof AgentLoopTurn>;
    prefixLength: number;
};

// Mirrors SqliteTurnStore's behavior — including transcript prefix dedup —
// so unit tests exercise the same storage semantics as production.
export class InMemoryTurnStore implements TurnStore {
    private rows = new Map<string, StoredTurn>();

    async create(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        if (this.rows.has(turn.id)) {
            throw new Error(`Turn already exists: ${turn.id}`);
        }
        // Mirror the SQLite UNIQUE(session_id, session_seq) tripwire — NULL
        // seqs never conflict, matching SQLite's distinct-NULLs semantics.
        if (turn.sessionId !== null && turn.sessionSeq !== null) {
            for (const { turn: existing } of this.rows.values()) {
                if (existing.sessionId === turn.sessionId && existing.sessionSeq === turn.sessionSeq) {
                    throw new Error(
                        `Turn with session seq already exists: ${turn.sessionId}#${turn.sessionSeq}`,
                    );
                }
            }
        }
        const prev = this.previousTurn(turn.sessionId, turn.sessionSeq);
        const { prefixLength, delta } = splitTranscript(turn, prev);
        this.rows.set(turn.id, {
            turn: structuredClone({ ...turn, messages: delta }),
            prefixLength,
        });
    }

    async get(id: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const row = this.rows.get(id);
        return row ? this.materialize(row) : null;
    }

    async update(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        const row = this.rows.get(turn.id);
        if (!row) {
            throw new Error(`Turn not found: ${turn.id}`);
        }
        if (turn.messages.length < row.prefixLength) {
            throw new Error(`Turn ${turn.id} shrank below its stored transcript prefix`);
        }
        this.rows.set(turn.id, {
            turn: structuredClone({ ...turn, messages: turn.messages.slice(row.prefixLength) }),
            prefixLength: row.prefixLength,
        });
    }

    async latestForSession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const turns = await this.listBySession(sessionId);
        return turns.length > 0 ? turns[turns.length - 1] : null;
    }

    async listBySession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]> {
        const rows = [...this.rows.values()]
            .filter(({ turn }) => turn.sessionId === sessionId)
            .sort((a, b) => (a.turn.sessionSeq ?? 0) - (b.turn.sessionSeq ?? 0));
        // Fold forward: each materialized turn is the prefix source for the next.
        const out: z.infer<typeof AgentLoopTurn>[] = [];
        let prev: z.infer<typeof AgentLoopTurn> | null = null;
        for (const row of rows) {
            const turn = structuredClone(row.turn);
            const prefixSource =
                prev !== null && prev.sessionSeq === (turn.sessionSeq ?? 0) - 1 ? prev : null;
            turn.messages = joinTranscript(turn.id, prefixSource, row.prefixLength, turn.messages);
            out.push(turn);
            prev = turn;
        }
        return out;
    }

    private materialize(row: StoredTurn): z.infer<typeof AgentLoopTurn> {
        const turn = structuredClone(row.turn);
        if (row.prefixLength > 0) {
            // recursion bottoms out at seq 1 (or the first non-deduped turn)
            const prev = this.previousTurn(turn.sessionId, turn.sessionSeq);
            turn.messages = joinTranscript(turn.id, prev, row.prefixLength, turn.messages);
        }
        return turn;
    }

    private previousTurn(
        sessionId: string | null,
        sessionSeq: number | null,
    ): z.infer<typeof AgentLoopTurn> | null {
        if (sessionId === null || sessionSeq === null || sessionSeq <= 1) return null;
        for (const row of this.rows.values()) {
            if (row.turn.sessionId === sessionId && row.turn.sessionSeq === sessionSeq - 1) {
                return this.materialize(row);
            }
        }
        return null;
    }
}
