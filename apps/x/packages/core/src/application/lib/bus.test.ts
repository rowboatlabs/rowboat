import { describe, expect, it } from "vitest";
import z from "zod";
import { RunEvent } from "@x/shared/dist/runs.js";
import { InMemoryBus } from "./bus.js";

function makeEvent(runId: string): z.infer<typeof RunEvent> {
    return {
        type: "run-processing-start",
        runId,
        subflow: [],
    };
}

describe("InMemoryBus", () => {
    it("keeps other handlers subscribed when a handler is unsubscribed twice", async () => {
        const bus = new InMemoryBus();
        const runId = "run-1";

        const receivedByA: z.infer<typeof RunEvent>[] = [];
        const receivedByB: z.infer<typeof RunEvent>[] = [];

        const unsubscribeA = await bus.subscribe(runId, async (event) => {
            receivedByA.push(event);
        });
        await bus.subscribe(runId, async (event) => {
            receivedByB.push(event);
        });

        // Double-unsubscribe of A must be a no-op the second time. The buggy
        // implementation ran splice(indexOf(A), 1) where indexOf(A) === -1 on
        // the second call, which removed the last handler (B) instead.
        unsubscribeA();
        unsubscribeA();

        await bus.publish(makeEvent(runId));

        expect(receivedByA).toHaveLength(0);
        expect(receivedByB).toHaveLength(1);
    });
});
