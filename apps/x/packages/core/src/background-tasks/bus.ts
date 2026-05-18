import type { BackgroundTaskAgentEventType } from '@x/shared/dist/background-task.js';

type Handler = (event: BackgroundTaskAgentEventType) => void;

class BackgroundTaskBus {
    private subs: Handler[] = [];

    publish(event: BackgroundTaskAgentEventType): void {
        for (const handler of this.subs) {
            handler(event);
        }
    }

    subscribe(handler: Handler): () => void {
        this.subs.push(handler);
        return () => {
            const idx = this.subs.indexOf(handler);
            if (idx >= 0) this.subs.splice(idx, 1);
        };
    }
}

export const backgroundTaskBus = new BackgroundTaskBus();
