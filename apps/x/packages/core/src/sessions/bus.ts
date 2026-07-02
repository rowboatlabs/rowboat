import type { SessionBusEvent } from "@x/shared/dist/sessions.js";

// Ephemeral fan-out toward the renderer (bridged over IPC in the app layer).
// Publishing is fire-and-forget; nothing durable depends on delivery.
export interface ISessionBus {
    publish(event: SessionBusEvent): void;
}
