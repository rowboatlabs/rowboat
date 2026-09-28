import { describe, expect, it } from "vitest";
import { isHeartbeat, parseSseFrame } from "./events.js";

describe("parseSseFrame", () => {
    it("reads the documented envelope from a data line", () => {
        const event = parseSseFrame('data: {"id":"evt_1","ts":"2026-09-28T10:00:00Z","type":"assistant.message","payload":{"text":"hi"}}');
        expect(event).toEqual({
            id: "evt_1",
            ts: "2026-09-28T10:00:00Z",
            type: "assistant.message",
            payload: { text: "hi" },
            raw: '{"id":"evt_1","ts":"2026-09-28T10:00:00Z","type":"assistant.message","payload":{"text":"hi"}}',
        });
    });

    it("prefers the event: field for the type and joins multi-line data", () => {
        const event = parseSseFrame('event: status\nid: 7\ndata: {"a":1,\ndata: "b":2}');
        expect(event?.type).toBe("status");
        expect(event?.id).toBe("7");
        expect(event?.payload).toEqual({ a: 1, b: 2 });
    });

    it("keeps non-JSON data as a string and treats comment-only frames as nothing", () => {
        expect(parseSseFrame("data: hello")?.payload).toBe("hello");
        expect(parseSseFrame(": ping")).toBeNull();
    });

    it("recognizes heartbeats by type only", () => {
        expect(isHeartbeat(parseSseFrame("event: heartbeat\ndata: {}")!)).toBe(true);
        expect(isHeartbeat(parseSseFrame('data: {"type":"ping"}')!)).toBe(true);
        expect(isHeartbeat(parseSseFrame('data: {"type":"tool_call"}')!)).toBe(false);
    });
});
