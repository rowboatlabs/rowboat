import type { ServiceEventType } from "@x/shared/dist/service-events.js";

type ServiceEventHandler = (event: ServiceEventType) => Promise<void> | void;

export class ServiceBus {
    private subscribers: ServiceEventHandler[] = [];

    async publish(event: ServiceEventType): Promise<void> {
        const pending = this.subscribers.map(async (handler) => handler(event));
        await Promise.all(pending);
    }

    async subscribe(handler: ServiceEventHandler): Promise<() => void> {
        this.subscribers.push(handler);
        return () => {
            const idx = this.subscribers.indexOf(handler);
            if (idx >= 0) {
                this.subscribers.splice(idx, 1);
            }
        };
    }
}

export const serviceBus = new ServiceBus();
