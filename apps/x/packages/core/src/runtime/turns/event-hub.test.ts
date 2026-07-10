import { describe, expect, it } from "vitest";
import type { TurnBusEvent } from "@x/shared/dist/turns.js";
import { TurnEventHub } from "./event-hub.js";

function busEvent(turnId: string, offset: number): TurnBusEvent {
    return {
        turnId,
        sessionId: null,
        event: {
            type: "text_delta",
            turnId,
            modelCallIndex: 0,
            delta: `e${offset}`,
        },
        offset,
    };
}

describe("TurnEventHub", () => {
    it("fans out to subscribeAll and turn-scoped listeners in order", () => {
        const hub = new TurnEventHub();
        const all: TurnBusEvent[] = [];
        const scoped: TurnBusEvent[] = [];
        hub.subscribeAll((e) => all.push(e));
        hub.subscribe("t1", (e) => scoped.push(e));

        hub.publish(busEvent("t1", 1));
        hub.publish(busEvent("t2", 1));
        hub.publish(busEvent("t1", 2));

        expect(all.map((e) => [e.turnId, e.offset])).toEqual([
            ["t1", 1],
            ["t2", 1],
            ["t1", 2],
        ]);
        expect(scoped.map((e) => e.offset)).toEqual([1, 2]);
    });

    it("unsubscribe stops delivery and cleans up turn-scoped sets", () => {
        const hub = new TurnEventHub();
        const seen: TurnBusEvent[] = [];
        const unsubAll = hub.subscribeAll((e) => seen.push(e));
        const unsubTurn = hub.subscribe("t1", (e) => seen.push(e));

        hub.publish(busEvent("t1", 1));
        expect(seen).toHaveLength(2);

        unsubAll();
        unsubTurn();
        hub.publish(busEvent("t1", 2));
        expect(seen).toHaveLength(2);
    });

    it("swallows listener errors and keeps delivering to other listeners", () => {
        const hub = new TurnEventHub();
        const seen: TurnBusEvent[] = [];
        hub.subscribeAll(() => {
            throw new Error("misbehaving observer");
        });
        hub.subscribeAll((e) => seen.push(e));
        hub.subscribe("t1", () => {
            throw new Error("misbehaving scoped observer");
        });
        hub.subscribe("t1", (e) => seen.push(e));

        expect(() => hub.publish(busEvent("t1", 1))).not.toThrow();
        expect(seen).toHaveLength(2);
    });
});
