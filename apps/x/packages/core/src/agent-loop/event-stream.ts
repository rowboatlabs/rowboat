// Tiny EventStream<TEvent, TResult>: push events, complete with a result.
//
// Live, bus-style delivery (same philosophy as the runtime's IBus): an event
// is delivered to the consumers attached at the moment it is pushed, and
// dropped otherwise — there is NO replay for late subscribers and no buffering
// when nobody listens. Events are cosmetic; every fact is persisted, so a
// consumer that attaches late (or misses events entirely) reconciles from the
// stored turn. Awaiting `result` never requires consuming events.
//
// Memory: a push with no consumers costs nothing; an attached consumer buffers
// only its own lag, freed as it iterates.

export class EventStream<TEvent, TResult> implements AsyncIterable<TEvent> {
    private listeners = new Set<TEvent[]>();
    private waiters: Array<() => void> = [];
    private done = false;

    readonly result: Promise<TResult>;
    private resolveResult!: (value: TResult) => void;
    private rejectResult!: (error: unknown) => void;

    constructor() {
        this.result = new Promise<TResult>((resolve, reject) => {
            this.resolveResult = resolve;
            this.rejectResult = reject;
        });
        // Mark rejections as handled so callers that only iterate events (or
        // ignore the handle entirely) don't trigger unhandled-rejection noise.
        // Awaiting `result` still rejects as expected.
        this.result.catch(() => undefined);
    }

    push(event: TEvent): void {
        if (this.done) return;
        for (const queue of this.listeners) queue.push(event);
        this.wake();
    }

    end(result: TResult): void {
        if (this.done) return;
        this.done = true;
        this.resolveResult(result);
        this.wake();
    }

    fail(error: unknown): void {
        if (this.done) return;
        this.done = true;
        this.rejectResult(error);
        this.wake();
    }

    private wake(): void {
        const waiters = this.waiters;
        this.waiters = [];
        for (const waiter of waiters) waiter();
    }

    // Hand-rolled (not an async generator) so the consumer attaches
    // SYNCHRONOUSLY when the iterator is created — `for await` does this at
    // loop entry. A generator body would only run on the first next(), one
    // microtask later, silently losing the events pushed in between.
    [Symbol.asyncIterator](): AsyncIterator<TEvent> {
        const queue: TEvent[] = [];
        this.listeners.add(queue);
        const detach = async (): Promise<IteratorResult<TEvent>> => {
            this.listeners.delete(queue);
            return { value: undefined, done: true };
        };
        return {
            next: async (): Promise<IteratorResult<TEvent>> => {
                for (;;) {
                    if (queue.length > 0) {
                        return { value: queue.shift()!, done: false };
                    }
                    if (this.done) return detach();
                    await new Promise<void>((resolve) => this.waiters.push(resolve));
                }
            },
            // for-await calls this on break/throw — drop the queue eagerly
            return: detach,
        };
    }
}
