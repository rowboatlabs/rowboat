import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { reduceTurn, type TurnEvent } from "@x/shared/dist/turns.js";
import type {
    CreateTurnInput,
    ITurnRuntime,
    TurnExecution,
    TurnOutcome,
} from "../turns/api.js";
import {
    HeadlessRunError,
    HeadlessAgentRunner,
    assistantText,
    lastAssistantText,
    toolInputPaths,
} from "./headless.js";
import type { IDefaultModelResolver } from "../../models/default-model-resolver.js";

type TEvent = z.infer<typeof TurnEvent>;

const TURN_ID = "2026-07-02T10-00-00Z-0000001-000";
const TS = "2026-07-02T10:00:00Z";

const echoTool = {
    toolId: "builtin:file-editText",
    name: "file-editText",
    description: "Edit",
    inputSchema: {},
    execution: "sync" as const,
    requiresHuman: false,
};

function turnLog(opts: {
    responseText?: string;
    toolCalls?: Array<{ id: string; name: string; input: unknown; invoked: boolean }>;
    failed?: string;
}): TEvent[] {
    const events: TEvent[] = [
        {
            type: "turn_created",
            schemaVersion: 1,
            turnId: TURN_ID,
            ts: TS,
            sessionId: null,
            agent: {
                requested: { agentId: "worker" },
                resolved: {
                    agentId: "worker",
                    systemPrompt: "SYS",
                    model: { provider: "fake", model: "m" },
                    tools: [echoTool],
                },
            },
            context: [],
            input: { role: "user", content: "go" },
            config: { autoPermission: true, humanAvailable: false, maxModelCalls: 20 },
        },
        {
            type: "model_call_requested",
            turnId: TURN_ID,
            ts: TS,
            modelCallIndex: 0,
            request: { messages: ["input"], parameters: {} },
        },
    ];
    const toolCalls = opts.toolCalls ?? [];
    if (toolCalls.length > 0) {
        events.push({
            type: "model_call_completed",
            turnId: TURN_ID,
            ts: TS,
            modelCallIndex: 0,
            message: {
                role: "assistant",
                content: toolCalls.map((tc) => ({
                    type: "tool-call" as const,
                    toolCallId: tc.id,
                    toolName: tc.name,
                    arguments: tc.input as never,
                })),
            },
            finishReason: "tool-calls",
            usage: {},
        });
        for (const tc of toolCalls) {
            if (!tc.invoked) continue;
            events.push({
                type: "tool_invocation_requested",
                turnId: TURN_ID,
                ts: TS,
                toolCallId: tc.id,
                toolId: "builtin:" + tc.name,
                toolName: tc.name,
                execution: "sync",
                input: tc.input as never,
            });
            events.push({
                type: "tool_result",
                turnId: TURN_ID,
                ts: TS,
                toolCallId: tc.id,
                toolName: tc.name,
                source: "sync",
                result: { output: "ok", isError: false },
            });
        }
    }
    if (opts.failed) {
        events.push({
            type: "model_call_failed",
            turnId: TURN_ID,
            ts: TS,
            modelCallIndex: 0,
            error: opts.failed,
        });
        events.push({ type: "turn_failed", turnId: TURN_ID, ts: TS, error: opts.failed, usage: {} });
    } else if (opts.responseText !== undefined && toolCalls.length === 0) {
        events.push({
            type: "model_call_completed",
            turnId: TURN_ID,
            ts: TS,
            modelCallIndex: 0,
            message: { role: "assistant", content: opts.responseText },
            finishReason: "stop",
            usage: {},
        });
        events.push({
            type: "turn_completed",
            turnId: TURN_ID,
            ts: TS,
            output: { role: "assistant", content: opts.responseText },
            finishReason: "stop",
            usage: {},
        });
    }
    return events;
}

class FakeRuntime implements ITurnRuntime {
    createInputs: CreateTurnInput[] = [];
    constructor(
        private readonly log: TEvent[],
        private readonly outcome: TurnOutcome,
    ) {}

    async createTurn(input: CreateTurnInput): Promise<string> {
        this.createInputs.push(input);
        return TURN_ID;
    }

    advanceTurn(): TurnExecution {
        return {
            events: (async function* () {})(),
            outcome: Promise.resolve(this.outcome),
        };
    }

    async getTurn() {
        return { turnId: TURN_ID, events: this.log };
    }
}

const completedOutcome: TurnOutcome = {
    status: "completed",
    output: { role: "assistant", content: "done" },
    finishReason: "stop",
    usage: {},
};

function createRunner(
    runtime: ITurnRuntime,
    resolve = vi.fn(async () => ({
        provider: "default-provider",
        model: "default-model",
    })),
): { runner: HeadlessAgentRunner; resolve: IDefaultModelResolver["resolve"] } {
    return {
        runner: new HeadlessAgentRunner({
            turnRuntime: runtime,
            defaultModelResolver: { resolve },
        }),
        resolve,
    };
}

describe("headless agent helpers", () => {
    it("assistantText handles string and parts content", () => {
        expect(assistantText({ role: "assistant", content: "hi" })).toBe("hi");
        expect(
            assistantText({
                role: "assistant",
                content: [
                    { type: "reasoning", text: "hmm" },
                    { type: "text", text: "a" },
                    { type: "text", text: "b" },
                ],
            }),
        ).toBe("ab");
        expect(assistantText({ role: "assistant", content: "" })).toBeNull();
    });

    it("lastAssistantText returns the final assistant text in the transcript", () => {
        const state = reduceTurn(turnLog({ responseText: "the summary" }));
        expect(lastAssistantText(state)).toBe("the summary");
        expect(lastAssistantText(reduceTurn(turnLog({ failed: "boom" })))).toBeNull();
    });

    it("toolInputPaths collects paths of invoked calls only", () => {
        const state = reduceTurn(
            turnLog({
                toolCalls: [
                    { id: "a", name: "file-editText", input: { path: "notes/x.md" }, invoked: true },
                    { id: "b", name: "file-editText", input: { path: "notes/y.md" }, invoked: true },
                    { id: "c", name: "file-writeText", input: { path: "notes/z.md" }, invoked: true },
                    { id: "d", name: "file-editText", input: { path: "never-ran.md" }, invoked: false },
                ],
            }),
        );
        expect(toolInputPaths(state, ["file-editText"])).toEqual(
            new Set(["notes/x.md", "notes/y.md"]),
        );
        expect(toolInputPaths(state, ["file-writeText"])).toEqual(new Set(["notes/z.md"]));
    });
});

describe("HeadlessAgentRunner", () => {
    it("creates a standalone auto-permission turn and returns the id before settling", async () => {
        const runtime = new FakeRuntime(turnLog({ responseText: "the summary" }), completedOutcome);
        const { runner, resolve } = createRunner(runtime);
        const handle = await runner.start({
            agentId: "worker",
            message: "go",
            model: "m",
            provider: "fake",
        });
        expect(handle.turnId).toBe(TURN_ID);
        expect(resolve).not.toHaveBeenCalled();
        expect(runtime.createInputs[0]).toMatchObject({
            agent: { agentId: "worker", overrides: { model: { provider: "fake", model: "m" } } },
            sessionId: null,
            context: [],
            input: { role: "user", content: "go" },
            config: { autoPermission: true, humanAvailable: false },
        });
        const result = await handle.done;
        expect(result.outcome.status).toBe("completed");
        expect(result.summary).toBe("the summary");
    });

    it("omits the model override when neither model nor provider is set", async () => {
        const runtime = new FakeRuntime(turnLog({ responseText: "ok" }), completedOutcome);
        const { runner, resolve } = createRunner(runtime);
        await runner.start({ agentId: "worker", message: "go" });
        expect(resolve).not.toHaveBeenCalled();
        expect(runtime.createInputs[0].agent.overrides).toBeUndefined();
    });

    it("uses an injected default only for a partial model override", async () => {
        const runtime = new FakeRuntime(turnLog({ responseText: "ok" }), completedOutcome);
        const { runner, resolve } = createRunner(runtime);
        await runner.start({
            agentId: "worker",
            message: "go",
            model: "custom-model",
        });
        expect(resolve).toHaveBeenCalledOnce();
        expect(runtime.createInputs[0].agent.overrides).toEqual({
            model: { provider: "default-provider", model: "custom-model" },
        });
    });

    it("throwOnError rejects done with HeadlessRunError on failed outcomes", async () => {
        const runtime = new FakeRuntime(turnLog({ failed: "provider exploded" }), {
            status: "failed",
            error: "provider exploded",
            usage: {},
        });
        const { runner } = createRunner(runtime);
        const handle = await runner.start({
            agentId: "worker",
            message: "go",
            throwOnError: true,
        });
        await expect(handle.done).rejects.toThrowError(HeadlessRunError);
        await expect(handle.done).rejects.toThrowError("provider exploded");
    });

    it("without throwOnError a failed outcome resolves (old wait semantics)", async () => {
        const runtime = new FakeRuntime(turnLog({ failed: "boom" }), {
            status: "failed",
            error: "boom",
            usage: {},
        });
        const { runner } = createRunner(runtime);
        const handle = await runner.start({ agentId: "worker", message: "go" });
        const result = await handle.done;
        expect(result.outcome.status).toBe("failed");
        expect(result.summary).toBeNull();
    });
});
