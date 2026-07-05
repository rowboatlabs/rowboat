import { describe, expect, it } from "vitest";
import { LocalLlmScheduler, isLocalProvider } from "./local.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("isLocalProvider", () => {
    it("treats ollama as local", () => {
        expect(isLocalProvider({ flavor: "ollama" })).toBe(true);
    });

    it("treats loopback openai-compatible endpoints as local", () => {
        expect(isLocalProvider({ flavor: "openai-compatible", baseURL: "http://localhost:1234/v1" })).toBe(true);
        expect(isLocalProvider({ flavor: "openai-compatible", baseURL: "http://127.0.0.1:8080/v1" })).toBe(true);
    });

    it("treats remote openai-compatible endpoints and cloud flavors as non-local", () => {
        expect(isLocalProvider({ flavor: "openai-compatible", baseURL: "https://api.together.xyz/v1" })).toBe(false);
        expect(isLocalProvider({ flavor: "openai" })).toBe(false);
        expect(isLocalProvider({ flavor: "rowboat" })).toBe(false);
    });
});

describe("LocalLlmScheduler", () => {
    it("serves waiters by priority, FIFO within a priority", async () => {
        const scheduler = new LocalLlmScheduler(1);
        const order: string[] = [];
        const first = deferred();

        const running = scheduler.run("background", undefined, async () => {
            await first.promise;
            order.push("initial");
        });
        await tick();

        const bg1 = scheduler.run("background", undefined, async () => {
            order.push("bg1");
        });
        const bg2 = scheduler.run("background", undefined, async () => {
            order.push("bg2");
        });
        const chat = scheduler.run("interactive", undefined, async () => {
            order.push("chat");
        });
        const classifier = scheduler.run("classifier", undefined, async () => {
            order.push("classifier");
        });
        await tick();

        first.resolve();
        await Promise.all([running, bg1, bg2, chat, classifier]);
        expect(order).toEqual(["initial", "chat", "classifier", "bg1", "bg2"]);
    });

    it("releases the slot when a task throws", async () => {
        const scheduler = new LocalLlmScheduler(1);
        await expect(
            scheduler.run("interactive", undefined, async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        // Slot must be free again.
        await scheduler.run("interactive", undefined, async () => undefined);
    });

    it("rejects queued waiters whose signal aborts, without leaking the slot", async () => {
        const scheduler = new LocalLlmScheduler(1);
        const gate = deferred();
        const running = scheduler.run("background", undefined, () => gate.promise);
        await tick();

        const controller = new AbortController();
        const waiting = scheduler.acquire("interactive", controller.signal);
        controller.abort();
        await expect(waiting).rejects.toThrow(/abort/i);

        gate.resolve();
        await running;
        // Queue is clean: a fresh acquire succeeds immediately.
        const release = await scheduler.acquire("background");
        release();
    });

    it("rejects immediately when acquiring with an already-aborted signal", async () => {
        const scheduler = new LocalLlmScheduler(1);
        const controller = new AbortController();
        controller.abort();
        await expect(scheduler.acquire("interactive", controller.signal)).rejects.toThrow(/abort/i);
    });

    it("allows up to maxConcurrent tasks at once", async () => {
        const scheduler = new LocalLlmScheduler(2);
        const gateA = deferred();
        const gateB = deferred();
        let active = 0;
        let peak = 0;
        const track = async (gate: Promise<void>) => {
            active++;
            peak = Math.max(peak, active);
            await gate;
            active--;
        };
        const a = scheduler.run("background", undefined, () => track(gateA.promise));
        const b = scheduler.run("background", undefined, () => track(gateB.promise));
        await tick();
        expect(peak).toBe(2);
        gateA.resolve();
        gateB.resolve();
        await Promise.all([a, b]);
    });
});
