import { describe, expect, it } from "vitest";
import { HotStream } from "./stream.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const item of iterable) {
        out.push(item);
    }
    return out;
}

describe("HotStream", () => {
    it("buffers events pushed before a consumer attaches", async () => {
        const stream = new HotStream<number, string>();
        stream.push(1);
        stream.push(2);
        stream.end("done");
        expect(await collect(stream.events)).toEqual([1, 2]);
        expect(await stream.outcome).toBe("done");
    });

    it("outcome resolves without draining events", async () => {
        const stream = new HotStream<number, string>();
        stream.push(1);
        stream.push(2);
        stream.end("done");
        expect(await stream.outcome).toBe("done");
    });

    it("delivers events in order across await boundaries", async () => {
        const stream = new HotStream<number, string>();
        const consumer = collect(stream.events);
        stream.push(1);
        await Promise.resolve();
        stream.push(2);
        stream.push(3);
        stream.end("done");
        expect(await consumer).toEqual([1, 2, 3]);
    });

    it("closing the consumer drops future events without affecting outcome", async () => {
        const stream = new HotStream<number, string>();
        stream.push(1);
        stream.push(2);
        for await (const event of stream.events) {
            expect(event).toBe(1);
            break; // closes the iterator
        }
        stream.push(3); // dropped
        stream.end("done");
        expect(await collect(stream.events)).toEqual([]);
        expect(await stream.outcome).toBe("done");
    });

    it("failure drains queued events, then throws, and rejects outcome with the same error", async () => {
        const stream = new HotStream<number, string>();
        const boom = new Error("boom");
        stream.push(1);
        stream.fail(boom);
        const seen: number[] = [];
        await expect(
            (async () => {
                for await (const event of stream.events) {
                    seen.push(event);
                }
            })(),
        ).rejects.toBe(boom);
        expect(seen).toEqual([1]);
        await expect(stream.outcome).rejects.toBe(boom);
    });

    it("ignores pushes and settlement after completion", async () => {
        const stream = new HotStream<number, string>();
        stream.end("first");
        stream.push(9);
        stream.end("second");
        stream.fail(new Error("late"));
        expect(await stream.outcome).toBe("first");
        expect(await collect(stream.events)).toEqual([]);
    });

    it("a waiting consumer wakes on end", async () => {
        const stream = new HotStream<number, string>();
        const consumer = collect(stream.events);
        await Promise.resolve();
        stream.end("done");
        expect(await consumer).toEqual([]);
    });
});
