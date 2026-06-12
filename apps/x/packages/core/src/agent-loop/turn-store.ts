import { z } from "zod";
import { AgentLoopTurn } from "./types.js";

// Durable storage for turns. The per-turn mutex lives ABOVE the store (in
// AgentLoopImpl), not in it — stores only read and write whole turns.
export interface TurnStore {
    create(turn: z.infer<typeof AgentLoopTurn>): Promise<void>;
    get(id: string): Promise<z.infer<typeof AgentLoopTurn> | null>;
    update(turn: z.infer<typeof AgentLoopTurn>): Promise<void>;
    // Session linkage queries (used by the sessions layer); ordered by sessionSeq.
    latestForSession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn> | null>;
    listBySession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]>;
}
