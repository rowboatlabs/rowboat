import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { TurnContext, TurnEvent } from "@x/shared/dist/turns.js";
import {
    ElidingContextResolver,
    elideHistoricToolResults,
} from "./context-elision.js";
import { TurnRepoContextResolver } from "./context-resolver.js";
import { InMemoryTurnRepo } from "./in-memory-turn-repo.js";

type TEvent = z.infer<typeof TurnEvent>;

function user(text: string) {
    return { role: "user" as const, content: text };
}

function assistant(text: string) {
    return { role: "assistant" as const, content: text };
}

function toolMsg(content: string, toolName = "file-readText") {
    return {
        role: "tool" as const,
        content,
        toolCallId: "tc1",
        toolName,
    };
}

// A completed turn containing one tool round trip whose result has the given
// output, followed by a final text response.
function toolTurnLog(
    turnId: string,
    context: z.infer<typeof TurnContext>,
    toolOutput: string,
): TEvent[] {
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
            context,
            input: user("do it"),
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
            result: { output: toolOutput, isError: false },
        },
        {
            type: "model_call_requested",
            turnId,
            ts,
            modelCallIndex: 1,
            request: {
                messages: ["assistant:0", "toolResult:tc1"],
                parameters: {},
            },
        },
        {
            type: "model_call_completed",
            turnId,
            ts,
            modelCallIndex: 1,
            message: assistant("done"),
            finishReason: "stop",
            usage: {},
        },
        {
            type: "turn_completed",
            turnId,
            ts,
            output: assistant("done"),
            finishReason: "stop",
            usage: {},
        },
    ];
}

const T1 = "2026-07-02T10-00-00Z-0000001-000";

describe("elideHistoricToolResults", () => {
    it("replaces tool results above the threshold with a placeholder", () => {
        const big = "x".repeat(101);
        const elided = elideHistoricToolResults([toolMsg(big)], 100);
        expect(elided).toHaveLength(1);
        expect(elided[0]).toMatchObject({
            role: "tool",
            toolCallId: "tc1",
            toolName: "file-readText",
        });
        expect(elided[0].content).toContain("elided");
        expect(elided[0].content).toContain("file-readText");
        expect(elided[0].content).toContain("101");
    });

    it("keeps tool results at or below the threshold verbatim", () => {
        const exact = toolMsg("x".repeat(100));
        expect(elideHistoricToolResults([exact], 100)).toEqual([exact]);
    });

    it("leaves non-tool messages untouched", () => {
        const messages = [user("q".repeat(500)), assistant("a".repeat(500))];
        expect(elideHistoricToolResults(messages, 100)).toEqual(messages);
    });

    it("is idempotent at realistic thresholds (placeholder is well under them)", () => {
        const once = elideHistoricToolResults([toolMsg("x".repeat(5000))], 1000);
        expect(once[0].content.length).toBeLessThan(1000);
        expect(elideHistoricToolResults(once, 1000)).toEqual(once);
    });

    it("is deterministic for the same input", () => {
        const messages = [toolMsg("x".repeat(5000)), user("q"), assistant("a")];
        expect(elideHistoricToolResults(messages, 100)).toEqual(
            elideHistoricToolResults(messages, 100),
        );
    });
});

describe("ElidingContextResolver", () => {
    function resolver(
        repo: InMemoryTurnRepo,
        policy: { enabled: boolean; thresholdChars: number },
    ) {
        return new ElidingContextResolver({
            inner: new TurnRepoContextResolver({ turnRepo: repo }),
            loadPolicy: () => policy,
        });
    }

    it("elides oversized tool results in the resolved prefix", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(toolTurnLog(T1, [], "x".repeat(200)));
        const resolved = await resolver(repo, {
            enabled: true,
            thresholdChars: 100,
        }).resolve({ previousTurnId: T1 });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toContain("elided");
        // The rest of the transcript is intact.
        expect(resolved.map((m) => m.role)).toEqual([
            "user",
            "assistant",
            "tool",
            "assistant",
        ]);
    });

    it("returns the prefix unchanged when the policy is disabled", async () => {
        const repo = new InMemoryTurnRepo();
        const output = "x".repeat(200);
        repo.seed(toolTurnLog(T1, [], output));
        const resolved = await resolver(repo, {
            enabled: false,
            thresholdChars: 100,
        }).resolve({ previousTurnId: T1 });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toBe(output);
    });

    it("keeps small tool results verbatim when enabled", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(toolTurnLog(T1, [], "small"));
        const resolved = await resolver(repo, {
            enabled: true,
            thresholdChars: 100,
        }).resolve({ previousTurnId: T1 });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toBe("small");
    });
});
