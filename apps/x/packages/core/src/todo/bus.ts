import type { TodoEventType } from '@x/shared/dist/todo.js';

type Handler = (event: TodoEventType) => void;

class TodoBus {
    private subs: Handler[] = [];

    publish(event: TodoEventType): void {
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

export const todoBus = new TodoBus();
