import { describe, expect, it, vi } from "vitest";
import type z from "zod";
import { RunEvent } from "@x/shared/dist/runs.js";
import { InMemoryBus } from "./bus.js";

function makeEvent(runId: string): z.infer<typeof RunEvent> {
    return {
        type: "run-processing-start",
        runId,
        subflow: [],
    } as z.infer<typeof RunEvent>;
}

describe("InMemoryBus", () => {
    it("delivers events to all handlers subscribed to a runId", async () => {
        const bus = new InMemoryBus();
        const a = vi.fn(async () => {});
        const b = vi.fn(async () => {});

        await bus.subscribe("run-1", a);
        await bus.subscribe("run-1", b);
        await bus.publish(makeEvent("run-1"));

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it("stops delivering to a handler after it unsubscribes", async () => {
        const bus = new InMemoryBus();
        const a = vi.fn(async () => {});

        const unsubscribe = await bus.subscribe("run-1", a);
        unsubscribe();
        await bus.publish(makeEvent("run-1"));

        expect(a).not.toHaveBeenCalled();
    });

    it("treats double-unsubscribe as a no-op and keeps other handlers (#491)", async () => {
        const bus = new InMemoryBus();
        const a = vi.fn(async () => {});
        const b = vi.fn(async () => {});

        const unsubscribeA = await bus.subscribe("run-1", a);
        await bus.subscribe("run-1", b);

        unsubscribeA();
        unsubscribeA(); // second call must not remove handler b

        await bus.publish(makeEvent("run-1"));

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });
});
