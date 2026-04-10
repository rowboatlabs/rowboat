import type { TrackEventType } from '@x/shared/dist/track-block.js';

type Handler = (event: TrackEventType) => void;

class TrackBus {
    private subs: Handler[] = [];

    publish(event: TrackEventType): void {
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

export const trackBus = new TrackBus();
