// Ephemeral process-lifecycle events (turn-runtime-design.md §17). Never
// persisted, never replayed; if the process crashes the information
// disappears, which accurately reflects that no execution is known active.
export interface TurnProcessingStart {
    type: "turn-processing-start";
    turnId: string;
}

export interface TurnProcessingEnd {
    type: "turn-processing-end";
    turnId: string;
}

export type TurnLifecycleEvent = TurnProcessingStart | TurnProcessingEnd;

export interface ITurnLifecycleBus {
    publish(event: TurnLifecycleEvent): void;
}

// Default in-process fan-out. Observers must never affect turn semantics, so
// listener errors are swallowed.
export class EmitterTurnLifecycleBus implements ITurnLifecycleBus {
    private listeners = new Set<(event: TurnLifecycleEvent) => void>();

    publish(event: TurnLifecycleEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // observational only
            }
        }
    }

    subscribe(listener: (event: TurnLifecycleEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
