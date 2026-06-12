// Serializes async work per key. Unlike the try-lock in runs/lock.ts, callers
// queue instead of failing — operations on the same key run in order. Used
// per-turn by the agent loop and per-session by the sessions layer.
export class KeyedMutex {
    private chains = new Map<string, Promise<unknown>>();

    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.chains.get(key) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        const tail: Promise<void> = next
            .catch(() => undefined)
            .then(() => {
                // Drop the entry once the chain is fully drained.
                if (this.chains.get(key) === tail) this.chains.delete(key);
            });
        this.chains.set(key, tail);
        return next;
    }
}
