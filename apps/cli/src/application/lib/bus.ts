import { RunEvent } from "../../entities/run-events.js";
import z from "zod";

export interface IBus {
    publish(event: z.infer<typeof RunEvent>): Promise<void>;

    // subscribe accepts a handler to handle events
    // and returns a function to unsubscribe
    subscribe(runId: string, handler: (event: z.infer<typeof RunEvent>) => Promise<void>): Promise<() => void>;
}

export class InMemoryBus implements IBus {
    private subscribers: Map<string, ((event: z.infer<typeof RunEvent>) => Promise<void>)[]> = new Map();

    async publish(event: z.infer<typeof RunEvent>): Promise<void> {
        const pending: Promise<void>[] = [];
        for (const subscriber of this.subscribers.get(event.runId) || []) {
            pending.push(subscriber(event));
        }
        for (const subscriber of this.subscribers.get('*') || []) {
            pending.push(subscriber(event));
        }
        await Promise.all(pending);
    }

    async subscribe(runId: string, handler: (event: z.infer<typeof RunEvent>) => Promise<void>): Promise<() => void> {
        if (!this.subscribers.has(runId)) {
            this.subscribers.set(runId, []);
        }
        this.subscribers.get(runId)!.push(handler);
        return () => {
            this.subscribers.get(runId)!.splice(this.subscribers.get(runId)!.indexOf(handler), 1);
        };
    }
}