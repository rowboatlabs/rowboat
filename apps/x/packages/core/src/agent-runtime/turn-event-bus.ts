import { z } from "zod";
import type { SessionBusEvent } from "@x/shared/dist/sessions.js";
import type { TurnEventMeta, TurnObserver } from "../agent-loop/turn-observer.js";
import type { AgentLoopTurn, TurnEvent } from "../agent-loop/types.js";

export type { SessionBusEvent };
export type SessionBusListener = (event: SessionBusEvent) => void;

// Fan-out bus that doubles as the loop's TurnObserver. Fire-and-forget, same
// philosophy as the old runtime's IBus: a listener that throws or joins late
// never affects the loop — the durable truth is the persisted turn.
export class TurnEventBus implements TurnObserver {
    private listeners = new Set<SessionBusListener>();

    subscribe(listener: SessionBusListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    onEvent(meta: TurnEventMeta, event: TurnEvent): void {
        this.publish({ kind: "event", turnId: meta.turnId, sessionId: meta.sessionId, event });
    }

    onState(turn: z.infer<typeof AgentLoopTurn>): void {
        this.publish({ kind: "state", turnId: turn.id, sessionId: turn.sessionId, turn });
    }

    private publish(event: SessionBusEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // A misbehaving subscriber must never break the loop or siblings.
            }
        }
    }
}
