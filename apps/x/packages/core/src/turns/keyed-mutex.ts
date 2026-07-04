// In-process per-key exclusion. Cross-process coordination is explicitly out
// of scope for the turn runtime (single Electron main process).
export class KeyedMutex {
    private tails = new Map<string, Promise<unknown>>();

    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.tails.get(key) ?? Promise.resolve();
        const next = prev.then(
            () => fn(),
            () => fn(),
        );
        this.tails.set(key, next);
        try {
            return await next;
        } finally {
            if (this.tails.get(key) === next) {
                this.tails.delete(key);
            }
        }
    }
}
