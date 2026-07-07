// Hot execution stream (turn-runtime-design.md §16). Execution starts
// independently of event consumption; events buffer in an unbounded in-memory
// queue until the single assumed consumer attaches. If the consumer closes,
// subsequent events are dropped; closing never cancels execution. On
// infrastructure failure, iteration drains already-queued events and then
// throws, and the outcome rejects with the same error.
export class HotStream<TEvent, TOutcome> {
    private queue: TEvent[] = [];
    private waiters: Array<() => void> = [];
    private done = false;
    private failure: { error: unknown } | null = null;
    private consumerClosed = false;

    readonly outcome: Promise<TOutcome>;
    private resolveOutcome!: (outcome: TOutcome) => void;
    private rejectOutcome!: (error: unknown) => void;

    constructor() {
        this.outcome = new Promise<TOutcome>((resolve, reject) => {
            this.resolveOutcome = resolve;
            this.rejectOutcome = reject;
        });
        // The outcome may legitimately never be awaited (fire-and-forget
        // callers); don't surface unhandled rejections for it.
        this.outcome.catch(() => undefined);
    }

    push(event: TEvent): void {
        if (this.done || this.consumerClosed) {
            return;
        }
        this.queue.push(event);
        this.wake();
    }

    end(outcome: TOutcome): void {
        if (this.done) {
            return;
        }
        this.done = true;
        this.resolveOutcome(outcome);
        this.wake();
    }

    fail(error: unknown): void {
        if (this.done) {
            return;
        }
        this.done = true;
        this.failure = { error };
        this.rejectOutcome(error);
        this.wake();
    }

    private wake(): void {
        const waiters = this.waiters;
        this.waiters = [];
        for (const waiter of waiters) {
            waiter();
        }
    }

    get events(): AsyncIterable<TEvent> {
        return {
            [Symbol.asyncIterator]: (): AsyncIterator<TEvent> => ({
                next: async (): Promise<IteratorResult<TEvent>> => {
                    for (;;) {
                        if (this.consumerClosed) {
                            return { value: undefined, done: true };
                        }
                        const event = this.queue.shift();
                        if (event !== undefined) {
                            return { value: event, done: false };
                        }
                        if (this.done) {
                            if (this.failure) {
                                throw this.failure.error;
                            }
                            return { value: undefined, done: true };
                        }
                        await new Promise<void>((resolve) =>
                            this.waiters.push(resolve),
                        );
                    }
                },
                return: async (): Promise<IteratorResult<TEvent>> => {
                    this.consumerClosed = true;
                    this.queue.length = 0;
                    return { value: undefined, done: true };
                },
            }),
        };
    }
}
