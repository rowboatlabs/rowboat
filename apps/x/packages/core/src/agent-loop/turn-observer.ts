import { z } from "zod";
import type { AgentLoopTurn, TurnEvent } from "./types.js";

export type TurnEventMeta = { turnId: string; sessionId: string | null };

// Side-channel for everything the loop does, so an integration layer can fan it
// onto a bus without consuming each turn's handle. onEvent fires for every live
// event (deltas, tool/permission lifecycle); onState fires on every committed
// fact (each persist) carrying the full turn snapshot. Both are best-effort and
// never affect loop control flow.
export interface TurnObserver {
    onEvent(meta: TurnEventMeta, event: TurnEvent): void;
    onState(turn: z.infer<typeof AgentLoopTurn>): void;
}

export class NullTurnObserver implements TurnObserver {
    onEvent(): void {}
    onState(): void {}
}
