import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { TurnEvent, TurnState } from "@x/shared/dist/turns.js";
import type { ITurnRuntime } from "../turns/api.js";
import type {
    HeadlessAgentHandle,
    HeadlessAgentOptions,
    HeadlessAgentResult,
    IHeadlessAgentRunner,
} from "./headless.js";
import { runSpawnedAgent } from "./spawn-agent.js";

const TS = "2026-07-07T10:00:00Z";

function parentCreated(
    overrides: {
        requested?: z.infer<typeof TurnEvent> extends never ? never : unknown;
    } & Record<string, unknown> = {},
): Array<z.infer<typeof TurnEvent>> {
    return [
        {
            type: "turn_created",
            schemaVersion: 1,
            turnId: "parent-1",
            ts: TS,
            sessionId: null,
            agent: {
                requested: (overrides.requested ?? { agentId: "copilot" }) as never,
                resolved: {
                    agentId: "copilot",
                    systemPrompt: "s",
                    model: { provider: "parent-p", model: "parent-m" },
                    tools: [],
                },
            },
            context: [],
            input: { role: "user", content: "hi" },
            config: {
                autoPermission: true,
                humanAvailable: false,
                maxModelCalls: 50,
            },
        } as z.infer<typeof TurnEvent>,
    ];
}

function fakeServices(opts: {
    parentEvents?: Array<z.infer<typeof TurnEvent>>;
    childResult?: Partial<HeadlessAgentResult>;
    startError?: string;
    globalMaxModelCalls?: number;
}) {
    const started: HeadlessAgentOptions[] = [];
    const turnRuntime = {
        getTurn: async () => ({
            turnId: "parent-1",
            events: opts.parentEvents ?? parentCreated(),
        }),
    } as unknown as ITurnRuntime;
    const headlessRunner: IHeadlessAgentRunner = {
        start: async (options: HeadlessAgentOptions): Promise<HeadlessAgentHandle> => {
            if (opts.startError) {
                throw new Error(opts.startError);
            }
            started.push(options);
            const result: HeadlessAgentResult = {
                outcome: {
                    status: "completed",
                    output: { role: "assistant", content: "answer" },
                    finishReason: "stop",
                    usage: { totalTokens: 7 },
                },
                state: { modelCalls: [{}, {}] } as unknown as TurnState,
                summary: "answer",
                ...opts.childResult,
            };
            return { turnId: "child-1", done: Promise.resolve(result) };
        },
        run: async () => {
            throw new Error("unused");
        },
    };
    return {
        services: {
            turnRuntime,
            headlessRunner,
            ...(opts.globalMaxModelCalls === undefined
                ? {}
                : { globalMaxModelCalls: opts.globalMaxModelCalls }),
        },
        started,
    };
}

const signal = new AbortController().signal;

describe("runSpawnedAgent", () => {
    it("runs an inline child on the parent's model and returns the result envelope", async () => {
        const { services, started } = fakeServices({});
        const progress: unknown[] = [];
        const result = await runSpawnedAgent(
            { task: "find things", name: "researcher", instructions: "You research." },
            {
                parentTurnId: "parent-1",
                signal,
                services,
                onChildStarted: async (info) => {
                    progress.push(info);
                },
            },
        );
        expect(started[0].agent).toEqual({
            inline: {
                name: "researcher",
                instructions: "You research.",
                model: { provider: "parent-p", model: "parent-m" },
            },
        });
        expect(started[0].maxModelCalls).toBe(50);
        expect(started[0].signal).toBe(signal);
        expect(progress).toEqual([
            { childTurnId: "child-1", agentName: "researcher", task: "find things" },
        ]);
        expect(result).toEqual({
            isError: false,
            output: {
                status: "completed",
                result: "answer",
                childTurnId: "child-1",
                agent: "researcher",
                modelCalls: 2,
                usage: { totalTokens: 7 },
            },
        });
    });

    it("marks by-id children with the subagent composition flag", async () => {
        const { services, started } = fakeServices({});
        await runSpawnedAgent(
            { task: "t", agent_id: "background-task-agent", max_model_calls: 5 },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(started[0].agent).toEqual({
            agentId: "background-task-agent",
            overrides: {
                model: { provider: "parent-p", model: "parent-m" },
                composition: { subagent: true },
            },
        });
        expect(started[0].maxModelCalls).toBe(5);
    });

    it("passes reasoning effort through to the child headless turn", async () => {
        const { services, started } = fakeServices({});
        await runSpawnedAgent(
            {
                task: "compare these options carefully",
                instructions: "You analyze tradeoffs.",
                reasoning_effort: "high",
            },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(started[0].reasoningEffort).toBe("high");
    });

    it("rejects agent_id and instructions together", async () => {
        const { services } = fakeServices({});
        const result = await runSpawnedAgent(
            { task: "t", agent_id: "a", instructions: "b" },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(result.isError).toBe(true);
        expect(result.output).toMatch(/at most one/);
    });

    it("spawns a default worker when neither agent_id nor instructions is given", async () => {
        // Models routinely treat task (+ name/tools) as a complete spec; the
        // task-only form must work rather than cost a correction round-trip.
        const { services, started } = fakeServices({});
        const result = await runSpawnedAgent(
            { task: "find the weather", name: "london-weather", tools: ["web-search"] },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(result.isError).toBe(false);
        const agent = started[0].agent as {
            inline: { name: string; instructions: string; tools?: string[] };
        };
        expect(agent.inline.name).toBe("london-weather");
        expect(agent.inline.tools).toEqual(["web-search"]);
        expect(agent.inline.instructions).toMatch(/london-weather/);
        expect(agent.inline.instructions).toMatch(/headlessly/);
    });

    it("clamps a model-call budget above the global limit to it", async () => {
        const { services, started } = fakeServices({});
        const result = await runSpawnedAgent(
            { task: "t", instructions: "x", max_model_calls: 80 },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(result.isError).toBe(false);
        expect(started[0].maxModelCalls).toBe(50);
    });

    it("uses the configured global limit as the sub-agent default and cap", async () => {
        const { services, started } = fakeServices({ globalMaxModelCalls: 60 });
        await runSpawnedAgent(
            { task: "t", instructions: "x" },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(started[0].maxModelCalls).toBe(60);

        await runSpawnedAgent(
            { task: "t", instructions: "x", max_model_calls: 80 },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(started[1].maxModelCalls).toBe(60);

        await runSpawnedAgent(
            { task: "t", instructions: "x", max_model_calls: 5 },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(started[2].maxModelCalls).toBe(5);
    });

    it("refuses to spawn from a child parent (depth cap)", async () => {
        for (const requested of [
            { inline: { name: "c", instructions: "x" } },
            { agentId: "copilot", overrides: { composition: { subagent: true } } },
        ]) {
            const { services, started } = fakeServices({
                parentEvents: parentCreated({ requested }),
            });
            const result = await runSpawnedAgent(
                { task: "t", instructions: "x" },
                { parentTurnId: "parent-1", signal, services },
            );
            expect(result.isError).toBe(true);
            expect(result.output).toMatch(/cannot spawn further/);
            expect(started).toHaveLength(0);
        }
    });

    it("reports resolution failures conversationally", async () => {
        const { services } = fakeServices({ startError: "agent not found: nope" });
        const result = await runSpawnedAgent(
            { task: "t", agent_id: "nope" },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(result).toEqual({
            isError: true,
            output: "spawn-agent: agent not found: nope",
        });
    });

    it("returns child failure as an error envelope with the partial answer", async () => {
        const { services } = fakeServices({
            childResult: {
                outcome: {
                    status: "failed",
                    error: "model exploded",
                    usage: {},
                },
                summary: "got halfway",
            },
        });
        const result = await runSpawnedAgent(
            { task: "t", instructions: "x" },
            { parentTurnId: "parent-1", signal, services },
        );
        expect(result.isError).toBe(true);
        expect(result.output).toMatchObject({
            status: "failed",
            error: "model exploded",
            partialResult: "got halfway",
            childTurnId: "child-1",
        });
    });
});
