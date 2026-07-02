import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
    MODEL_CALL_LIMIT_ERROR_CODE,
    type TurnContext,
    TurnCorruptionError,
    type TurnEvent,
} from "@x/shared/dist/turns.js";
import { TurnRepoContextResolver } from "./context-resolver.js";
import { InMemoryTurnRepo } from "./in-memory-turn-repo.js";

type TEvent = z.infer<typeof TurnEvent>;

function user(text: string) {
    return { role: "user" as const, content: text };
}

function assistant(text: string) {
    return { role: "assistant" as const, content: text };
}

// A minimal completed turn: input → one model call → text response.
function completedTurnLog(
    turnId: string,
    context: z.infer<typeof TurnContext>,
    inputText: string,
    responseText: string,
): TEvent[] {
    const ts = "2026-07-02T10:00:00Z";
    return [
        {
            type: "turn_created",
            schemaVersion: 1,
            turnId,
            ts,
            sessionId: "sess-1",
            agent: {
                requested: { agentId: "copilot" },
                resolved: {
                    agentId: "copilot",
                    systemPrompt: "SYS",
                    model: { provider: "fake", model: "m" },
                    tools: [],
                },
            },
            context,
            input: user(inputText),
            config: {
                autoPermission: false,
                humanAvailable: true,
                maxModelCalls: 20,
            },
        },
        {
            type: "model_call_requested",
            turnId,
            ts,
            modelCallIndex: 0,
            request: {
                ...(Array.isArray(context) ? {} : { contextRef: context }),
                messages:
                    Array.isArray(context) && context.length > 0
                        ? ["context", "input"]
                        : ["input"],
                parameters: {},
            },
        },
        {
            type: "model_call_completed",
            turnId,
            ts,
            modelCallIndex: 0,
            message: assistant(responseText),
            finishReason: "stop",
            usage: {},
        },
        {
            type: "turn_completed",
            turnId,
            ts,
            output: assistant(responseText),
            finishReason: "stop",
            usage: {},
        },
    ];
}

// A turn that failed at the model-call limit after one tool round trip; its
// transcript is structurally complete including the synthetic closure.
function limitFailedTurnLog(turnId: string): TEvent[] {
    const ts = "2026-07-02T10:00:00Z";
    const echo = {
        toolId: "tool.echo",
        name: "echo",
        description: "Echo",
        inputSchema: {},
        execution: "sync" as const,
        requiresHuman: false,
    };
    const call = {
        role: "assistant" as const,
        content: [
            {
                type: "tool-call" as const,
                toolCallId: "tc1",
                toolName: "echo",
                arguments: {},
            },
        ],
    };
    return [
        {
            type: "turn_created",
            schemaVersion: 1,
            turnId,
            ts,
            sessionId: "sess-1",
            agent: {
                requested: { agentId: "copilot" },
                resolved: {
                    agentId: "copilot",
                    systemPrompt: "SYS",
                    model: { provider: "fake", model: "m" },
                    tools: [echo],
                },
            },
            context: [],
            input: user("do it"),
            config: {
                autoPermission: false,
                humanAvailable: true,
                maxModelCalls: 1,
            },
        },
        {
            type: "model_call_requested",
            turnId,
            ts,
            modelCallIndex: 0,
            request: {
                messages: ["input"],
                parameters: {},
            },
        },
        {
            type: "model_call_completed",
            turnId,
            ts,
            modelCallIndex: 0,
            message: call,
            finishReason: "tool-calls",
            usage: {},
        },
        {
            type: "tool_invocation_requested",
            turnId,
            ts,
            toolCallId: "tc1",
            toolId: "tool.echo",
            toolName: "echo",
            execution: "sync",
            input: {},
        },
        {
            type: "tool_result",
            turnId,
            ts,
            toolCallId: "tc1",
            toolName: "echo",
            source: "sync",
            result: { output: "echoed", isError: false },
        },
        {
            type: "turn_failed",
            turnId,
            ts,
            error: "Model call limit of 1 reached before the turn completed.",
            code: MODEL_CALL_LIMIT_ERROR_CODE,
            usage: {},
        },
    ];
}

const T1 = "2026-07-02T10-00-00Z-0000001-000";
const T2 = "2026-07-02T10-00-00Z-0000002-000";
const T3 = "2026-07-02T10-00-00Z-0000003-000";

describe("TurnRepoContextResolver", () => {
    it("passes inline context through unchanged", async () => {
        const repo = new InMemoryTurnRepo();
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        const inline = [user("a"), assistant("b")];
        expect(await resolver.resolve(inline)).toEqual(inline);
    });

    it("resolves a single reference to the referenced turn's transcript", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(completedTurnLog(T1, [], "first question", "first answer"));
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        expect(await resolver.resolve({ previousTurnId: T1 })).toEqual([
            user("first question"),
            assistant("first answer"),
        ]);
    });

    it("resolves a chain of references down to the inline base", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(completedTurnLog(T1, [user("preamble")], "q1", "a1"));
        repo.seed(completedTurnLog(T2, { previousTurnId: T1 }, "q2", "a2"));
        repo.seed(completedTurnLog(T3, { previousTurnId: T2 }, "q3", "a3"));
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        expect(await resolver.resolve({ previousTurnId: T3 })).toEqual([
            user("preamble"),
            user("q1"),
            assistant("a1"),
            user("q2"),
            assistant("a2"),
            user("q3"),
            assistant("a3"),
        ]);
    });

    it("includes failed turns' transcripts with synthetic closures", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(limitFailedTurnLog(T1));
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        const resolved = await resolver.resolve({ previousTurnId: T1 });
        expect(resolved.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
        expect(resolved[2]).toMatchObject({
            role: "tool",
            toolCallId: "tc1",
            content: "echoed",
        });
    });

    it("rejects references to missing turns as infrastructure errors", async () => {
        const repo = new InMemoryTurnRepo();
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        await expect(
            resolver.resolve({ previousTurnId: T1 }),
        ).rejects.toThrowError(/turn not found/);
    });

    it("resolveAgent materializes inherited snapshots through the chain", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(completedTurnLog(T1, [], "q1", "a1")); // concrete base
        const inheritedLog = completedTurnLog(T2, { previousTurnId: T1 }, "q2", "a2").map(
            (event) =>
                event.type === "turn_created"
                    ? {
                          ...event,
                          agent: {
                              ...event.agent,
                              resolved: {
                                  agentId: "copilot",
                                  model: { provider: "fake", model: "m" },
                                  inheritedFrom: T1,
                              },
                          },
                      }
                    : event,
        );
        repo.seed(inheritedLog);
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });

        const concrete = await resolver.resolveAgent({
            agentId: "copilot",
            systemPrompt: "SYS",
            model: { provider: "fake", model: "m" },
            tools: [],
        });
        expect(concrete.systemPrompt).toBe("SYS"); // passthrough

        const materialized = await resolver.resolveAgent({
            agentId: "copilot",
            model: { provider: "fake", model: "m2" },
            inheritedFrom: T2, // hops T2 -> T1
        });
        expect(materialized.systemPrompt).toBe("SYS");
        expect(materialized.tools).toEqual([]);
        // The inherited record's own model wins over the chain base's model.
        expect(materialized.model).toEqual({ provider: "fake", model: "m2" });
    });

    it("resolveAgent rejects cyclic inheritance as corruption", async () => {
        const repo = new InMemoryTurnRepo();
        const cyclic = completedTurnLog(T1, [], "q1", "a1").map((event) =>
            event.type === "turn_created"
                ? {
                      ...event,
                      context: { previousTurnId: T1 },
                      agent: {
                          ...event.agent,
                          resolved: {
                              agentId: "copilot",
                              model: { provider: "fake", model: "m" },
                              inheritedFrom: T1,
                          },
                      },
                  }
                : event,
        );
        // Fix the request contextRef to match the now-ref context.
        const fixed = cyclic.map((event) =>
            event.type === "model_call_requested"
                ? { ...event, request: { ...event.request, contextRef: { previousTurnId: T1 } } }
                : event,
        );
        repo.seed(fixed);
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        await expect(
            resolver.resolveAgent({
                agentId: "copilot",
                model: { provider: "fake", model: "m" },
                inheritedFrom: T1,
            }),
        ).rejects.toThrowError(TurnCorruptionError);
    });

    it("rejects cyclic reference chains as corruption", async () => {
        const repo = new InMemoryTurnRepo();
        // Two turns referencing each other (only constructable by corruption).
        repo.seed(completedTurnLog(T1, { previousTurnId: T2 }, "q1", "a1"));
        repo.seed(completedTurnLog(T2, { previousTurnId: T1 }, "q2", "a2"));
        const resolver = new TurnRepoContextResolver({ turnRepo: repo });
        await expect(
            resolver.resolve({ previousTurnId: T1 }),
        ).rejects.toThrowError(TurnCorruptionError);
    });
});
