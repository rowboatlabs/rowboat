import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
    SessionCorruptionError,
    SessionCreated,
    SessionEvent,
    SessionTurnAppended,
    reduceSession,
    sessionIndexEntry,
} from "./sessions.js";

type SEvent = z.infer<typeof SessionEvent>;

const SESSION_ID = "2026-07-02T09-00-00Z-0000042-000";
const MODEL = { provider: "openai", model: "gpt-test" };

function sessionCreated(
    overrides: Partial<z.infer<typeof SessionCreated>> = {},
): z.infer<typeof SessionCreated> {
    return {
        type: "session_created",
        schemaVersion: 1,
        sessionId: SESSION_ID,
        ts: "2026-07-02T09:00:00Z",
        ...overrides,
    };
}

function turnAppended(
    sessionSeq: number,
    turnId: string,
    overrides: Partial<z.infer<typeof SessionTurnAppended>> = {},
): z.infer<typeof SessionTurnAppended> {
    return {
        type: "turn_appended",
        sessionId: SESSION_ID,
        ts: `2026-07-02T09:0${sessionSeq}:00Z`,
        turnId,
        sessionSeq,
        agentId: "copilot",
        model: MODEL,
        ...overrides,
    };
}

function titleChanged(title: string, ts = "2026-07-02T09:05:00Z") {
    return {
        type: "title_changed" as const,
        sessionId: SESSION_ID,
        ts,
        title,
    };
}

function expectCorruption(events: SEvent[], match: string | RegExp): void {
    expect(() => reduceSession(events)).toThrowError(SessionCorruptionError);
    expect(() => reduceSession(events)).toThrowError(match);
}

describe("schemas", () => {
    it("session events round-trip through the SessionEvent schema", () => {
        const events: SEvent[] = [
            sessionCreated({ title: "Hello" }),
            turnAppended(1, "turn-1"),
            titleChanged("Renamed"),
        ];
        for (const event of events) {
            expect(SessionEvent.parse(event)).toEqual(event);
        }
    });

    it("rejects non-positive sessionSeq at the schema level", () => {
        expect(() => SessionEvent.parse(turnAppended(0, "turn-0"))).toThrowError();
    });
});

describe("reduceSession", () => {
    it("reduces a created-only log", () => {
        const state = reduceSession([sessionCreated()]);
        expect(state.definition.sessionId).toBe(SESSION_ID);
        expect(state.turns).toEqual([]);
        expect(state.latestTurnId).toBeUndefined();
        expect(state.title).toBeUndefined();
        expect(state.createdAt).toBe("2026-07-02T09:00:00Z");
        expect(state.updatedAt).toBe("2026-07-02T09:00:00Z");
    });

    it("folds turns in order with denormalized metadata", () => {
        const state = reduceSession([
            sessionCreated(),
            turnAppended(1, "turn-1"),
            turnAppended(2, "turn-2", { agentId: "researcher", model: { provider: "anthropic", model: "claude-x" } }),
        ]);
        expect(state.turns).toHaveLength(2);
        expect(state.turns[0]).toMatchObject({ turnId: "turn-1", sessionSeq: 1, agentId: "copilot" });
        expect(state.turns[1]).toMatchObject({
            turnId: "turn-2",
            sessionSeq: 2,
            agentId: "researcher",
            model: { provider: "anthropic", model: "claude-x" },
        });
        expect(state.latestTurnId).toBe("turn-2");
        expect(state.updatedAt).toBe("2026-07-02T09:02:00Z");
    });

    it("folds titles: creation default then last change wins", () => {
        const withDefault = reduceSession([sessionCreated({ title: "First message…" })]);
        expect(withDefault.title).toBe("First message…");

        const renamed = reduceSession([
            sessionCreated({ title: "First message…" }),
            titleChanged("Better title"),
            titleChanged("Best title", "2026-07-02T09:06:00Z"),
        ]);
        expect(renamed.title).toBe("Best title");
        expect(renamed.updatedAt).toBe("2026-07-02T09:06:00Z");
    });

    it("rejects an empty log", () => {
        expectCorruption([], /empty/);
    });

    it("rejects a log not starting with session_created", () => {
        expectCorruption([turnAppended(1, "turn-1")], /first event must be session_created/);
    });

    it("rejects duplicate session_created", () => {
        expectCorruption([sessionCreated(), sessionCreated()], /duplicate session_created/);
    });

    it("rejects mismatched session ids", () => {
        expectCorruption(
            [sessionCreated(), { ...turnAppended(1, "turn-1"), sessionId: "other" }],
            /does not match session/,
        );
    });

    it("rejects unsupported schema versions", () => {
        const bad = { ...sessionCreated(), schemaVersion: 2 } as unknown as SEvent;
        expectCorruption([bad], /unsupported session schema version/);
    });

    it("rejects unknown event types", () => {
        const bad = { type: "wat", sessionId: SESSION_ID, ts: "t" } as unknown as SEvent;
        expectCorruption([sessionCreated(), bad], /unknown session event type/);
    });

    it("rejects a first turn not at sessionSeq 1", () => {
        expectCorruption([sessionCreated(), turnAppended(2, "turn-2")], /out of order; expected 1/);
    });

    it("rejects gapped sessionSeq", () => {
        expectCorruption(
            [sessionCreated(), turnAppended(1, "turn-1"), turnAppended(3, "turn-3")],
            /out of order; expected 2/,
        );
    });

    it("rejects duplicate sessionSeq", () => {
        expectCorruption(
            [sessionCreated(), turnAppended(1, "turn-1"), turnAppended(1, "turn-1b")],
            /out of order; expected 2/,
        );
    });

    it("rejects duplicate turn ids", () => {
        expectCorruption(
            [sessionCreated(), turnAppended(1, "turn-1"), turnAppended(2, "turn-1")],
            /duplicate turnId/,
        );
    });
});

describe("sessionIndexEntry", () => {
    it("projects an entry with last-turn metadata and the provided status", () => {
        const state = reduceSession([
            sessionCreated({ title: "T" }),
            turnAppended(1, "turn-1"),
            turnAppended(2, "turn-2", { agentId: "researcher" }),
        ]);
        expect(sessionIndexEntry(state, "suspended")).toEqual({
            sessionId: SESSION_ID,
            title: "T",
            createdAt: "2026-07-02T09:00:00Z",
            updatedAt: "2026-07-02T09:02:00Z",
            turnCount: 2,
            lastAgentId: "researcher",
            lastModel: MODEL,
            latestTurnId: "turn-2",
            latestTurnStatus: "suspended",
        });
    });

    it("projects an empty session with status none", () => {
        const state = reduceSession([sessionCreated()]);
        const entry = sessionIndexEntry(state, "none");
        expect(entry.turnCount).toBe(0);
        expect(entry.lastAgentId).toBeUndefined();
        expect(entry.latestTurnStatus).toBe("none");
    });
});
