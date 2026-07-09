import type { TurnBusEvent } from "@x/shared/dist/turns.js";

// Process-wide turn event bus: the runtime publishes every turn's events here
// (durable events with their file offsets, plus live deltas), regardless of
// who started the turn — session chat, headless runners, spawned sub-agents.
// Ephemeral and observational, like the lifecycle bus: nothing durable depends
// on delivery, listener errors are swallowed, and a process crash losing the
// listeners accurately reflects that no execution is known active.
export interface ITurnEventBus {
    publish(event: TurnBusEvent): void;
}

type Listener = (event: TurnBusEvent) => void;

export class TurnEventHub implements ITurnEventBus {
    private readonly all = new Set<Listener>();
    private readonly byTurn = new Map<string, Set<Listener>>();

    publish(event: TurnBusEvent): void {
        for (const listener of this.all) {
            try {
                listener(event);
            } catch {
                // observational only
            }
        }
        const scoped = this.byTurn.get(event.turnId);
        if (!scoped) {
            return;
        }
        for (const listener of scoped) {
            try {
                listener(event);
            } catch {
                // observational only
            }
        }
    }

    subscribeAll(listener: Listener): () => void {
        this.all.add(listener);
        return () => this.all.delete(listener);
    }

    subscribe(turnId: string, listener: Listener): () => void {
        let scoped = this.byTurn.get(turnId);
        if (!scoped) {
            scoped = new Set();
            this.byTurn.set(turnId, scoped);
        }
        scoped.add(listener);
        return () => {
            const listeners = this.byTurn.get(turnId);
            if (!listeners) {
                return;
            }
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.byTurn.delete(turnId);
            }
        };
    }
}
