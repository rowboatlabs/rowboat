import { describe, expect, it } from "vitest";
import { EventStream } from "./event-stream.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of iterable) items.push(item);
    return items;
}

describe("EventStream", () => {
    it("yields pushed events and completes on end()", async () => {
        const stream = new EventStream<number, string>();
        const collecting = collect(stream);

        stream.push(1);
        stream.push(2);
        stream.end("done");

        expect(await collecting).toEqual([1, 2]);
        expect(await stream.result).toBe("done");
    });

    it("delivers events buffered before iteration starts", async () => {
        const stream = new EventStream<number, string>();
        stream.push(1);
        stream.push(2);
        stream.end("done");

        expect(await collect(stream)).toEqual([1, 2]);
    });

    it("resolves result without any event consumer", async () => {
        const stream = new EventStream<number, string>();
        stream.push(1);
        stream.end("done");

        expect(await stream.result).toBe("done");
    });

    it("rejects result and terminates iteration on fail()", async () => {
        const stream = new EventStream<number, string>();
        const collecting = collect(stream);

        stream.push(1);
        stream.fail(new Error("boom"));

        expect(await collecting).toEqual([1]);
        await expect(stream.result).rejects.toThrow("boom");
    });

    it("ignores pushes after completion", async () => {
        const stream = new EventStream<number, string>();
        stream.end("done");
        stream.push(99);

        expect(await collect(stream)).toEqual([]);
    });
});
