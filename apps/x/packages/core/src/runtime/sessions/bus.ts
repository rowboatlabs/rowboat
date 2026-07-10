import type { SessionBusEvent } from "@x/shared/dist/sessions.js";

// Ephemeral fan-out toward the renderer (bridged over IPC in the app layer).
// Publishing is fire-and-forget; nothing durable depends on delivery.
export interface ISessionBus {
    publish(event: SessionBusEvent): void;
}

// Default in-process fan-out; the app layer subscribes and forwards over IPC.
// Listener errors are swallowed: observers must never affect sessions.
export class EmitterSessionBus implements ISessionBus {
    private listeners = new Set<(event: SessionBusEvent) => void>();

    publish(event: SessionBusEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // observational only
            }
        }
    }

    subscribe(listener: (event: SessionBusEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
