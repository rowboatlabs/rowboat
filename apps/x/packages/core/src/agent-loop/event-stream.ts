// Tiny EventStream<TEvent, TResult>: push events, complete with a result.
// Consumers can iterate events (streaming) or just await the result
// (await-to-rest); consuming events is never required for correctness.

export class EventStream<TEvent, TResult> implements AsyncIterable<TEvent> {
    private buffer: TEvent[] = [];
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
        this.buffer.push(event);
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

    async *[Symbol.asyncIterator](): AsyncIterator<TEvent> {
        let index = 0;
        for (;;) {
            while (index < this.buffer.length) {
                yield this.buffer[index++];
            }
            if (this.done) return;
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
    }
}
