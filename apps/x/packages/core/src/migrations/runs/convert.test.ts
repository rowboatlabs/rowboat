import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RunEvent } from "@x/shared/dist/runs.js";
import { reduceTurn, turnTranscript } from "@x/shared/dist/turns.js";
import { reduceSession } from "@x/shared/dist/sessions.js";
import { convertRun } from "./convert.js";

const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "__fixtures__",
);

type RunEventT = z.infer<typeof RunEvent>;

function loadFixture(name: string): { log: RunEventT[]; runId: string } {
    const raw = fs.readFileSync(path.join(fixturesDir, name), "utf-8");
    const log = raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => RunEvent.parse(JSON.parse(line)));
    const start = log[0];
    if (start.type !== "start") throw new Error("fixture missing start event");
    return { log, runId: start.runId };
}

describe("convertRun", () => {
    it("non-copilot run -> a single standalone turn whose id is the runId", () => {
        const { log, runId } = loadFixture("knowledge-single-turn.jsonl");
        const result = convertRun(log, runId);

        expect(result.isSession).toBe(false);
        expect(result.session).toBeUndefined();
        expect(result.turns).toHaveLength(1);
        expect(result.turns[0].turnId).toBe(runId);

        const state = reduceTurn(result.turns[0].events);
        expect(state.terminal?.type).toBe("turn_completed");
        expect(state.definition.sessionId).toBeNull();
        // Standalone turn has inline (empty) context.
        expect(Array.isArray(state.definition.context)).toBe(true);
    });

    it("background-task run -> standalone turn, reasoning parts preserved", () => {
        const { log, runId } = loadFixture("background-task.jsonl");
        const result = convertRun(log, runId);

        expect(result.isSession).toBe(false);
        expect(result.turns[0].turnId).toBe(runId);

        const state = reduceTurn(result.turns[0].events);
        // The bg-task run interleaves tool-call + reasoning parts; they survive
        // verbatim on the completed model messages.
        const hasReasoning = state.modelCalls.some(
            (c) =>
                Array.isArray(c.response?.content) &&
                c.response.content.some((p) => p.type === "reasoning"),
        );
        expect(hasReasoning).toBe(true);
        // Every tool call resolved with a terminal result.
        expect(state.toolCalls.every((tc) => tc.result)).toBe(true);
    });

    it("copilot run -> session + one turn per user message, chained by previousTurnId", () => {
        const { log, runId } = loadFixture("copilot-multi-turn.jsonl");
        const result = convertRun(log, runId);

        expect(result.isSession).toBe(true);
        expect(result.session?.sessionId).toBe(runId);
        // Fixture has 3 user messages.
        expect(result.turns).toHaveLength(3);

        // Session reduces and lists the turns in order.
        const sessionState = reduceSession(result.session!.events);
        expect(sessionState.turns.map((t) => t.turnId)).toEqual(
            result.turns.map((t) => t.turnId),
        );
        expect(sessionState.turns.map((t) => t.sessionSeq)).toEqual([1, 2, 3]);

        // First turn has inline context; later turns reference their predecessor.
        const states = result.turns.map((t) => reduceTurn(t.events));
        expect(Array.isArray(states[0].definition.context)).toBe(true);
        expect(states[1].definition.context).toEqual({
            previousTurnId: result.turns[0].turnId,
        });
        expect(states[2].definition.context).toEqual({
            previousTurnId: result.turns[1].turnId,
        });
        // Every turn is completed and its session id points back to the session.
        for (const s of states) {
            expect(s.terminal?.type).toBe("turn_completed");
            expect(s.definition.sessionId).toBe(runId);
        }
    });

    it("copilot deny run -> runtime tool result flagged as error", () => {
        const { log, runId } = loadFixture("copilot-brew-deny.jsonl");
        const result = convertRun(log, runId);

        expect(result.isSession).toBe(true);
        const state = reduceTurn(result.turns[0].events);

        const denied = state.toolCalls.find(
            (tc) => tc.result?.source === "runtime",
        );
        expect(denied).toBeDefined();
        expect(denied?.result?.result.isError).toBe(true);
        // A denied call is resolved but never invoked.
        expect(denied?.permission?.resolved?.decision).toBe("deny");
        expect(denied?.invocation).toBeUndefined();
    });

    it("turnTranscript reproduces the original conversation slice", () => {
        const { log, runId } = loadFixture("copilot-multi-turn.jsonl");
        const result = convertRun(log, runId);

        // Reconstruct expected per-turn user/assistant text from the raw log.
        const userTexts: string[] = [];
        for (const e of log) {
            if (e.type === "message" && e.message.role === "user") {
                const c = e.message.content;
                userTexts.push(typeof c === "string" ? c : JSON.stringify(c));
            }
        }

        result.turns.forEach((turn, i) => {
            const transcript = turnTranscript(reduceTurn(turn.events));
            // The first message of each turn's transcript is its user input.
            expect(transcript[0].role).toBe("user");
            const c = transcript[0].content;
            expect(typeof c === "string" ? c : JSON.stringify(c)).toBe(
                userTexts[i],
            );
            // The last contributed message is an assistant response.
            expect(transcript[transcript.length - 1].role).toBe("assistant");
        });
    });
});
