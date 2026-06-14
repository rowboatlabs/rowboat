import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentLoopTurn } from "../agent-loop/types.js";
import { SessionBusEvent, TurnEventBus } from "./turn-event-bus.js";

function turn(overrides: Partial<z.infer<typeof AgentLoopTurn>> = {}): z.infer<typeof AgentLoopTurn> {
    const now = "2026-06-14T00:00:00Z";
    return {
        id: "t1",
        agentId: null,
        provider: null,
        model: null,
        permissionMode: "manual",
        useCase: null,
        subUseCase: null,
        sessionId: "s1",
        sessionSeq: 1,
        composeContext: null,
        messages: [],
        permissionRequests: [],
        permissionDecisions: [],
        startedTools: [],
        dispatchedTools: [],
        modelUsage: [],
        error: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe("TurnEventBus", () => {
    it("publishes onEvent as a tagged live event and onState as a snapshot", () => {
        const bus = new TurnEventBus();
        const seen: SessionBusEvent[] = [];
        bus.subscribe((e) => seen.push(e));

        bus.onEvent({ turnId: "t1", sessionId: "s1" }, { type: "text-delta", delta: "hi" });
        bus.onState(turn());

        expect(seen).toEqual([
            { kind: "event", turnId: "t1", sessionId: "s1", event: { type: "text-delta", delta: "hi" } },
            { kind: "state", turnId: "t1", sessionId: "s1", turn: turn() },
        ]);
    });

    it("fans out to every subscriber and stops after unsubscribe", () => {
        const bus = new TurnEventBus();
        const a: SessionBusEvent[] = [];
        const b: SessionBusEvent[] = [];
        const offA = bus.subscribe((e) => a.push(e));
        bus.subscribe((e) => b.push(e));

        bus.onEvent({ turnId: "t1", sessionId: "s1" }, { type: "tool-result", toolCallId: "x" });
        offA();
        bus.onEvent({ turnId: "t1", sessionId: "s1" }, { type: "tool-result", toolCallId: "y" });

        expect(a).toHaveLength(1);
        expect(b).toHaveLength(2);
    });

    it("isolates a throwing subscriber from the rest", () => {
        const bus = new TurnEventBus();
        const ok: SessionBusEvent[] = [];
        bus.subscribe(() => { throw new Error("boom"); });
        bus.subscribe((e) => ok.push(e));

        expect(() => bus.onState(turn())).not.toThrow();
        expect(ok).toHaveLength(1);
    });
});
