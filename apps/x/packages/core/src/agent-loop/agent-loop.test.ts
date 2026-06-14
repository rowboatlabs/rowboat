import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
    AssistantMessage,
    Message,
    ToolCallPart,
} from "@x/shared/dist/message.js";
import { AgentLoopImpl } from "./agent-loop.js";
import { EventStream } from "./event-stream.js";
import { InMemoryTurnStore } from "./in-memory-turn-store.js";
import type {
    ModelAdapter,
    ModelStepResult,
    ModelStepUsage,
    ModelStreamRequest,
} from "./model-adapter.js";
import type { PermissionClassification, PermissionGate } from "./permission-gate.js";
import type { ToolRunner, ToolRunResult } from "./tool-runner.js";
import type { TurnStore } from "./turn-store.js";
import {
    AgentLoopTurn,
    deriveTurnStatus,
    totalUsage,
    type ModelStreamEvent,
} from "./types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function userMsg(text: string): z.infer<typeof Message> {
    return { role: "user", content: text };
}

function assistantText(text: string): z.infer<typeof AssistantMessage> {
    return { role: "assistant", content: text };
}

function toolCall(toolCallId: string, toolName: string): z.infer<typeof ToolCallPart> {
    return { type: "tool-call", toolCallId, toolName, arguments: {} };
}

function assistantToolCalls(
    ...calls: z.infer<typeof ToolCallPart>[]
): z.infer<typeof AssistantMessage> {
    return { role: "assistant", content: calls };
}

type ModelStep =
    | {
        kind: "message";
        message: z.infer<typeof AssistantMessage>;
        deltas?: string[];
        usage?: ModelStepUsage;
    }
    | { kind: "error"; error: unknown }
    | { kind: "hang" };

class FakeModelAdapter implements ModelAdapter {
    calls = 0;
    lastSystem: string | null = null;

    constructor(private steps: ModelStep[]) {}

    stream(req: ModelStreamRequest): EventStream<ModelStreamEvent, ModelStepResult> {
        this.calls++;
        this.lastSystem = req.system;
        const out = new EventStream<ModelStreamEvent, ModelStepResult>();
        const step = this.steps.shift();
        void (async () => {
            await Promise.resolve();
            if (!step) {
                const error = new Error("FakeModelAdapter: no scripted step left");
                out.push({ type: "error", error });
                out.fail(error);
                return;
            }
            if (step.kind === "hang") {
                out.push({ type: "text-delta", delta: "partial" });
                // Mirror VercelModelAdapter's abort behavior: push an error
                // event AND fail the result (the loop must rely only on the
                // latter — regression for the stop-bricks-turn bug).
                req.signal.addEventListener("abort", () => {
                    const error = new Error("aborted");
                    out.push({ type: "error", error });
                    out.fail(error);
                }, { once: true });
                return;
            }
            if (step.kind === "error") {
                out.push({ type: "error", error: step.error });
                out.fail(step.error);
                return;
            }
            for (const delta of step.deltas ?? []) {
                out.push({ type: "text-delta", delta });
            }
            if (typeof step.message.content !== "string") {
                for (const part of step.message.content) {
                    if (part.type === "tool-call") out.push({ type: "tool-call", toolCall: part });
                }
            }
            out.push({ type: "finish", message: step.message });
            out.end({ message: step.message, usage: step.usage ?? null });
        })();
        return out;
    }
}

class FakeToolRunner implements ToolRunner {
    ran: string[] = [];

    constructor(
        private behaviors: Record<string, (call: z.infer<typeof ToolCallPart>) => ToolRunResult> = {},
    ) {}

    async definitions() {
        return [];
    }

    async run(call: z.infer<typeof ToolCallPart>): Promise<ToolRunResult> {
        this.ran.push(call.toolCallId);
        const behavior = this.behaviors[call.toolName];
        return behavior ? behavior(call) : { type: "result", value: `ok:${call.toolName}` };
    }
}

class FakePermissionGate implements PermissionGate {
    checkCalls = 0;
    classifyCalls = 0;

    constructor(
        private opts: {
            required?: (toolName: string) => boolean;
            classify?: (call: z.infer<typeof ToolCallPart>) => PermissionClassification;
        } = {},
    ) {}

    async check(call: z.infer<typeof ToolCallPart>) {
        this.checkCalls++;
        return this.opts.required?.(call.toolName)
            ? { required: true as const, request: { tool: call.toolName } }
            : { required: false as const };
    }

    async classify(call: z.infer<typeof ToolCallPart>): Promise<PermissionClassification> {
        this.classifyCalls++;
        return this.opts.classify
            ? this.opts.classify(call)
            : { decision: "abstained", reason: "unsure" };
    }
}

// Records a snapshot per store write so tests can assert write batching.
class SnapshottingStore implements TurnStore {
    private inner = new InMemoryTurnStore();
    snapshots: z.infer<typeof AgentLoopTurn>[] = [];

    async create(turn: z.infer<typeof AgentLoopTurn>) {
        this.snapshots.push(structuredClone(turn));
        await this.inner.create(turn);
    }

    async get(id: string) {
        return this.inner.get(id);
    }

    async update(turn: z.infer<typeof AgentLoopTurn>) {
        this.snapshots.push(structuredClone(turn));
        await this.inner.update(turn);
    }

    async latestForSession(sessionId: string) {
        return this.inner.latestForSession(sessionId);
    }

    async listBySession(sessionId: string) {
        return this.inner.listBySession(sessionId);
    }
}

function makeLoop(opts: {
    steps?: ModelStep[];
    runner?: FakeToolRunner;
    gate?: FakePermissionGate;
    store?: TurnStore;
    systemComposer?: { system(): Promise<string | null> };
    maxIterations?: number;
} = {}) {
    const store = opts.store ?? new InMemoryTurnStore();
    const adapter = new FakeModelAdapter(opts.steps ?? []);
    const runner = opts.runner ?? new FakeToolRunner();
    const gate = opts.gate ?? new FakePermissionGate();
    const loop = new AgentLoopImpl({
        store,
        modelAdapter: adapter,
        toolRunner: runner,
        permissionGate: gate,
        ...(opts.systemComposer ? { systemComposer: opts.systemComposer } : {}),
        ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    });
    return { loop, store, adapter, runner, gate };
}

function emptyTurn(
    id: string,
    overrides: Partial<z.infer<typeof AgentLoopTurn>> = {},
): z.infer<typeof AgentLoopTurn> {
    const now = new Date().toISOString();
    return {
        id,
        agentId: null,
        provider: null,
        model: null,
        permissionMode: "manual",
        useCase: null,
        subUseCase: null,
        sessionId: null,
        sessionSeq: null,
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

function toolMessages(turn: z.infer<typeof AgentLoopTurn>) {
    return turn.messages.filter((m) => m.role === "tool");
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("AgentLoopImpl", () => {
    it("completes a simple text turn and persists input metadata", async () => {
        const { loop } = makeLoop({ steps: [{ kind: "message", message: assistantText("hi!") }] });

        const turn = await (await loop.createTurn({
            agentId: "a1",
            provider: "openai",
            model: "gpt-x",
            messages: [userMsg("hello")],
        })).result;

        expect(turn.agentId).toBe("a1");
        expect(turn.provider).toBe("openai");
        expect(turn.model).toBe("gpt-x");
        expect(turn.permissionMode).toBe("manual");
        expect(turn.messages).toEqual([userMsg("hello"), assistantText("hi!")]);
        expect(turn.completedAt).not.toBeNull();
        expect(deriveTurnStatus(turn)).toBe("completed");
    });

    it("rejects a turn with no input messages", async () => {
        const { loop } = makeLoop();
        // invalid input now fails at the call itself — nothing is persisted
        await expect(loop.createTurn({ messages: [] })).rejects.toThrow();
    });

    it("runs tool calls: result and error both append ToolMessages and continue", async () => {
        const calls = [toolCall("tc1", "good"), toolCall("tc2", "bad")];
        const { loop, runner } = makeLoop({
            steps: [
                { kind: "message", message: assistantToolCalls(...calls) },
                { kind: "message", message: assistantText("done") },
            ],
            runner: new FakeToolRunner({
                good: () => ({ type: "result", value: { answer: 42 } }),
                bad: () => ({ type: "error", value: "boom" }),
            }),
        });

        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;

        expect(runner.ran).toEqual(["tc1", "tc2"]);
        expect(toolMessages(turn)).toEqual([
            { role: "tool", content: '{"answer":42}', toolCallId: "tc1", toolName: "good" },
            { role: "tool", content: "boom", toolCallId: "tc2", toolName: "bad" },
        ]);
        // tool error is NOT a turn error
        expect(turn.error).toBeNull();
        expect(deriveTurnStatus(turn)).toBe("completed");
        expect(turn.startedTools.map((t) => t.toolCallId)).toEqual(["tc1", "tc2"]);
    });

    it("suspends on a pending tool and resumes via setToolResult", async () => {
        const { loop, adapter } = makeLoop({
            steps: [
                { kind: "message", message: assistantToolCalls(toolCall("tc1", "ask-human")) },
                { kind: "message", message: assistantText("thanks") },
            ],
            runner: new FakeToolRunner({ "ask-human": () => ({ type: "pending" }) }),
        });

        const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(deriveTurnStatus(waiting)).toBe("waiting");
        expect(waiting.dispatchedTools.map((t) => t.toolCallId)).toEqual(["tc1"]);
        expect(adapter.calls).toBe(1); // no model call while waiting

        const done = await loop.setToolResult(waiting.id, { toolCallId: "tc1", result: "blue" }).result;
        expect(toolMessages(done)).toEqual([
            { role: "tool", content: "blue", toolCallId: "tc1", toolName: "ask-human" },
        ]);
        expect(deriveTurnStatus(done)).toBe("completed");
    });

    it("requires all dispatched results before the loop continues", async () => {
        const { loop, adapter } = makeLoop({
            steps: [
                {
                    kind: "message",
                    message: assistantToolCalls(toolCall("tc1", "job"), toolCall("tc2", "job")),
                },
                { kind: "message", message: assistantText("done") },
            ],
            runner: new FakeToolRunner({ job: () => ({ type: "pending" }) }),
        });

        const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(waiting.dispatchedTools).toHaveLength(2);

        const stillWaiting = await loop.setToolResult(waiting.id, { toolCallId: "tc1", result: "r1" }).result;
        expect(deriveTurnStatus(stillWaiting)).toBe("waiting");
        expect(adapter.calls).toBe(1);

        const done = await loop.setToolResult(waiting.id, { toolCallId: "tc2", result: "r2" }).result;
        expect(deriveTurnStatus(done)).toBe("completed");
        expect(adapter.calls).toBe(2);
    });

    it("rejects setToolResult for a tool call that is not awaiting an external result", async () => {
        const { loop } = makeLoop({
            steps: [{ kind: "message", message: assistantToolCalls(toolCall("tc1", "job")) }],
            runner: new FakeToolRunner({ job: () => ({ type: "pending" }) }),
        });

        const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        await expect(
            loop.setToolResult(waiting.id, { toolCallId: "bogus", result: "x" }).result,
        ).rejects.toThrow("not awaiting an external result");
    });

    describe("permissions (manual mode)", () => {
        it("batch-creates all permission requests in one store write", async () => {
            const store = new SnapshottingStore();
            const { loop } = makeLoop({
                store,
                steps: [{
                    kind: "message",
                    message: assistantToolCalls(toolCall("tc1", "write"), toolCall("tc2", "exec")),
                }],
                gate: new FakePermissionGate({ required: () => true }),
            });

            const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
            expect(deriveTurnStatus(turn)).toBe("waiting");
            expect(turn.permissionRequests.map((r) => r.toolCallId)).toEqual(["tc1", "tc2"]);

            // no snapshot with exactly one request — both landed in a single write
            const counts = store.snapshots.map((s) => s.permissionRequests.length);
            expect(counts).not.toContain(1);
            expect(counts).toContain(2);
        });

        it("executes on grant; denial appends decision + ToolMessage atomically", async () => {
            const store = new SnapshottingStore();
            const { loop, runner } = makeLoop({
                store,
                steps: [
                    {
                        kind: "message",
                        message: assistantToolCalls(toolCall("tc1", "write"), toolCall("tc2", "exec")),
                    },
                    { kind: "message", message: assistantText("done") },
                ],
                gate: new FakePermissionGate({ required: () => true }),
            });

            const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;

            const afterDeny = await loop
                .respondToPermission(waiting.id, "tc2", "denied", "nope").result;
            expect(deriveTurnStatus(afterDeny)).toBe("waiting"); // tc1 still open
            expect(toolMessages(afterDeny)).toEqual([
                { role: "tool", content: "Permission denied by the user: nope", toolCallId: "tc2", toolName: "exec" },
            ]);
            // decision + denial ToolMessage landed in the same write
            const denyWrite = store.snapshots.find((s) =>
                s.permissionDecisions.some((d) => d.toolCallId === "tc2"));
            expect(denyWrite?.messages.some((m) => m.role === "tool" && m.toolCallId === "tc2")).toBe(true);

            const done = await loop.respondToPermission(waiting.id, "tc1", "granted").result;
            expect(runner.ran).toEqual(["tc1"]); // denied tool never ran
            expect(deriveTurnStatus(done)).toBe("completed");
            expect(done.permissionDecisions).toHaveLength(2);
            expect(done.permissionDecisions.every((d) => d.decidedBy === "user")).toBe(true);
        });

        it("rejects a response for a call without an open request", async () => {
            const { loop } = makeLoop({
                steps: [{ kind: "message", message: assistantToolCalls(toolCall("tc1", "write")) }],
                gate: new FakePermissionGate({ required: () => true }),
            });
            const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
            await expect(
                loop.respondToPermission(waiting.id, "bogus", "granted").result,
            ).rejects.toThrow("No open permission request");
        });

        it("does not re-ask after a grant: granted fact persists across resume", async () => {
            const store = new InMemoryTurnStore();
            const gate = new FakePermissionGate({ required: () => true });
            const { loop, runner } = makeLoop({
                store,
                gate,
                steps: [{ kind: "message", message: assistantText("done") }],
            });

            // crafted state: granted decision persisted, tool not yet started
            await store.create(emptyTurn("t1", {
                messages: [userMsg("go"), assistantToolCalls(toolCall("tc1", "write"))],
                permissionRequests: [{ toolCallId: "tc1", request: { tool: "write" }, requestedAt: "2026-06-12T00:00:00Z" }],
                permissionDecisions: [{
                    toolCallId: "tc1", decidedBy: "user", decision: "granted",
                    reason: null, decidedAt: "2026-06-12T00:00:01Z",
                }],
            }));

            const turn = await loop.resumeTurn("t1").result;
            expect(gate.checkCalls).toBe(0); // never re-evaluated
            expect(runner.ran).toEqual(["tc1"]);
            expect(deriveTurnStatus(turn)).toBe("completed");
        });

        it("never calls the classifier in manual mode", async () => {
            const gate = new FakePermissionGate({ required: () => true });
            const { loop } = makeLoop({
                gate,
                steps: [{ kind: "message", message: assistantToolCalls(toolCall("tc1", "write")) }],
            });
            const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
            expect(deriveTurnStatus(turn)).toBe("waiting");
            expect(gate.classifyCalls).toBe(0);
        });
    });

    describe("permissions (auto mode / classifier)", () => {
        it("applies classifier grant and deny with reasons", async () => {
            const { loop, runner } = makeLoop({
                steps: [
                    {
                        kind: "message",
                        message: assistantToolCalls(toolCall("tc1", "read"), toolCall("tc2", "exec")),
                    },
                    { kind: "message", message: assistantText("done") },
                ],
                gate: new FakePermissionGate({
                    required: () => true,
                    classify: (call) => call.toolName === "read"
                        ? { decision: "granted", reason: "read-only" }
                        : { decision: "denied", reason: "destructive" },
                }),
            });

            const turn = await (await loop.createTurn({
                messages: [userMsg("go")],
                permissionMode: "auto",
            })).result;

            expect(deriveTurnStatus(turn)).toBe("completed");
            expect(runner.ran).toEqual(["tc1"]);
            expect(turn.permissionDecisions).toEqual([
                expect.objectContaining({ toolCallId: "tc1", decidedBy: "classifier", decision: "granted", reason: "read-only" }),
                expect.objectContaining({ toolCallId: "tc2", decidedBy: "classifier", decision: "denied", reason: "destructive" }),
            ]);
            expect(toolMessages(turn).find((m) => m.toolCallId === "tc2")?.content)
                .toBe("Permission denied by the auto-permission classifier: destructive");
        });

        it("abstain waits on the user, persists, and is not re-run on resume", async () => {
            const gate = new FakePermissionGate({
                required: () => true,
                classify: () => ({ decision: "abstained", reason: "unsure" }),
            });
            const { loop, runner } = makeLoop({
                gate,
                steps: [
                    { kind: "message", message: assistantToolCalls(toolCall("tc1", "write")) },
                    { kind: "message", message: assistantText("done") },
                ],
            });

            const waiting = await (await loop.createTurn({
                messages: [userMsg("go")],
                permissionMode: "auto",
            })).result;
            expect(deriveTurnStatus(waiting)).toBe("waiting");
            expect(gate.classifyCalls).toBe(1);

            // resume must not re-run the classifier — the abstention is a fact
            const stillWaiting = await loop.resumeTurn(waiting.id).result;
            expect(gate.classifyCalls).toBe(1);
            expect(deriveTurnStatus(stillWaiting)).toBe("waiting");

            // user can decide after an abstention
            const done = await loop.respondToPermission(waiting.id, "tc1", "granted").result;
            expect(runner.ran).toEqual(["tc1"]);
            expect(deriveTurnStatus(done)).toBe("completed");
        });
    });

    describe("crash recovery", () => {
        it("resume treats started-but-unresolved tools as interrupted; never re-runs", async () => {
            const store = new InMemoryTurnStore();
            const { loop, runner } = makeLoop({
                store,
                steps: [{ kind: "message", message: assistantText("recovered") }],
            });

            await store.create(emptyTurn("t1", {
                messages: [userMsg("go"), assistantToolCalls(toolCall("tc1", "send-email"))],
                startedTools: [{ toolCallId: "tc1", startedAt: "2026-06-12T00:00:00Z" }],
            }));

            const turn = await loop.resumeTurn("t1").result;
            expect(runner.ran).toEqual([]); // NOT re-run
            expect(toolMessages(turn)[0]?.content).toContain("interrupted");
            expect(deriveTurnStatus(turn)).toBe("completed");
        });

        it("resume runs tools that were committed but never started", async () => {
            const store = new InMemoryTurnStore();
            const { loop, runner } = makeLoop({
                store,
                steps: [{ kind: "message", message: assistantText("done") }],
            });

            await store.create(emptyTurn("t1", {
                messages: [userMsg("go"), assistantToolCalls(toolCall("tc1", "calc"))],
            }));

            const turn = await loop.resumeTurn("t1").result;
            expect(runner.ran).toEqual(["tc1"]);
            expect(deriveTurnStatus(turn)).toBe("completed");
        });
    });

    it("stopTurn mid-stream persists no partial message; the stop is a terminal error", async () => {
        const { loop } = makeLoop({ steps: [{ kind: "hang" }] });

        const handle = await loop.createTurn({ messages: [userMsg("go")] });
        // wait for the first streamed delta, then stop
        const iterator = handle.events[Symbol.asyncIterator]();
        const first = await iterator.next();
        expect(first.value).toEqual({ type: "text-delta", delta: "partial" });

        const stopped = await loop.stopTurn(handle.id);
        expect(stopped.messages).toEqual([userMsg("go")]); // no partial persisted
        expect(stopped.error?.code).toBe("stopped");
        expect(deriveTurnStatus(stopped)).toBe("error");
        await expect(handle.result).resolves.toBeTruthy(); // original handle also rests

        // stop is terminal: the turn can never be resumed or mutated
        await expect(loop.resumeTurn(handle.id).result).rejects.toThrow("terminal error");
    });

    it("stopTurn immediately after createTurn aborts the queued advance", async () => {
        const { loop, adapter } = makeLoop({
            steps: [{ kind: "message", message: assistantText("should not run") }],
        });

        // Stop as soon as the handle exists — the advance is still queued
        // behind the mutex and its controller must already be abortable.
        const handle = await loop.createTurn({ messages: [userMsg("go")] });
        const stopped = await loop.stopTurn(handle.id);

        expect(adapter.calls).toBe(0); // model never called
        expect(stopped.messages).toEqual([userMsg("go")]); // input fact persisted
        expect(stopped.error?.code).toBe("stopped");
        expect(deriveTurnStatus(stopped)).toBe("error");
    });

    it("stopTurn never overwrites a finished turn's outcome", async () => {
        const { loop } = makeLoop({ steps: [{ kind: "message", message: assistantText("hi") }] });
        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;

        const stopped = await loop.stopTurn(turn.id);
        expect(stopped.error).toBeNull();
        expect(deriveTurnStatus(stopped)).toBe("completed");
        // completed is just as terminal as stopped: no resume either
        await expect(loop.resumeTurn(turn.id).result).rejects.toThrow("already completed");
    });

    it("a stopped turn rejects every mutation: tool results, permission responses, resume", async () => {
        const { loop } = makeLoop({
            steps: [{
                kind: "message",
                message: assistantToolCalls(toolCall("tc1", "job"), toolCall("tc2", "write")),
            }],
            runner: new FakeToolRunner({ job: () => ({ type: "pending" }) }),
            gate: new FakePermissionGate({ required: (name) => name === "write" }),
        });

        // turn waits on tc2's permission; tc1 is deferred behind the batch
        const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(deriveTurnStatus(waiting)).toBe("waiting");

        const stopped = await loop.stopTurn(waiting.id);
        expect(stopped.error?.code).toBe("stopped");

        await expect(
            loop.setToolResult(waiting.id, { toolCallId: "tc1", result: "late" }).result,
        ).rejects.toThrow("terminal error");
        await expect(
            loop.respondToPermission(waiting.id, "tc2", "granted").result,
        ).rejects.toThrow("terminal error");
        await expect(loop.resumeTurn(waiting.id).result).rejects.toThrow("terminal error");

        // and none of it mutated the stopped turn
        const after = await loop.getTurn(waiting.id);
        expect(after).toEqual(stopped);
    });

    it("stopTurn terminates a waiting turn so it can be abandoned", async () => {
        const { loop } = makeLoop({
            steps: [{ kind: "message", message: assistantToolCalls(toolCall("tc1", "write")) }],
            gate: new FakePermissionGate({ required: () => true }),
        });
        const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(deriveTurnStatus(waiting)).toBe("waiting");

        const stopped = await loop.stopTurn(waiting.id);
        expect(stopped.error?.code).toBe("stopped");
        expect(deriveTurnStatus(stopped)).toBe("error");
        await expect(loop.respondToPermission(waiting.id, "tc1", "granted").result)
            .rejects.toThrow("terminal error");
    });

    it("a throwing tool runner becomes an error ToolMessage, not a turn error", async () => {
        const { loop } = makeLoop({
            steps: [
                { kind: "message", message: assistantToolCalls(toolCall("tc1", "flaky")) },
                { kind: "message", message: assistantText("recovered") },
            ],
            runner: new FakeToolRunner({
                flaky: () => { throw new Error("ECONNRESET"); },
            }),
        });

        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(turn.error).toBeNull();
        expect(toolMessages(turn)[0]?.content).toBe("Tool execution failed: ECONNRESET");
        expect(deriveTurnStatus(turn)).toBe("completed");
    });

    it("an unpaired denied decision never derives as executable", async () => {
        const store = new InMemoryTurnStore();
        const { loop, runner } = makeLoop({ store });

        // anomalous state: denied decision WITHOUT its paired denial ToolMessage
        await store.create(emptyTurn("t1", {
            messages: [userMsg("go"), assistantToolCalls(toolCall("tc1", "write"))],
            permissionRequests: [{ toolCallId: "tc1", request: {}, requestedAt: "2026-06-12T00:00:00Z" }],
            permissionDecisions: [{
                toolCallId: "tc1", decidedBy: "user", decision: "denied",
                reason: null, decidedAt: "2026-06-12T00:00:01Z",
            }],
        }));

        const turn = await loop.resumeTurn("t1").result;
        expect(runner.ran).toEqual([]); // the denied tool must NOT execute
        expect(deriveTurnStatus(turn)).toBe("waiting");
    });

    it("model failure is a terminal turn error; further mutations reject", async () => {
        const { loop } = makeLoop({ steps: [{ kind: "error", error: new Error("rate limited") }] });

        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(deriveTurnStatus(turn)).toBe("error");
        expect(turn.error?.message).toBe("rate limited");

        await expect(
            loop.setToolResult(turn.id, { toolCallId: "x", result: "y" }).result,
        ).rejects.toThrow("terminal error");
        await expect(
            loop.respondToPermission(turn.id, "x", "granted").result,
        ).rejects.toThrow("terminal error");
    });

    it("errors out when the iteration cap is exceeded", async () => {
        const { loop } = makeLoop({
            maxIterations: 3,
            steps: [
                { kind: "message", message: assistantToolCalls(toolCall("tc1", "calc")) },
                { kind: "message", message: assistantToolCalls(toolCall("tc2", "calc")) },
            ],
        });

        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(deriveTurnStatus(turn)).toBe("error");
        expect(turn.error?.message).toContain("exceeded 3 iterations");
    });

    it("serializes concurrent mutations without losing updates", async () => {
        const { loop } = makeLoop({
            steps: [
                {
                    kind: "message",
                    message: assistantToolCalls(toolCall("tc1", "job"), toolCall("tc2", "job")),
                },
                { kind: "message", message: assistantText("done") },
            ],
            runner: new FakeToolRunner({ job: () => ({ type: "pending" }) }),
        });

        const waiting = await (await loop.createTurn({ messages: [userMsg("go")] })).result;

        const [a, b] = await Promise.all([
            loop.setToolResult(waiting.id, { toolCallId: "tc1", result: "r1" }).result,
            loop.setToolResult(waiting.id, { toolCallId: "tc2", result: "r2" }).result,
        ]);

        const final = [a, b].find((t) => deriveTurnStatus(t) === "completed");
        expect(final).toBeTruthy();
        expect(toolMessages(final!).map((m) => m.content).sort()).toEqual(["r1", "r2"]);
    });

    it("streams events in order; result resolves identically without a consumer", async () => {
        const { loop } = makeLoop({
            steps: [
                {
                    kind: "message",
                    message: assistantToolCalls(toolCall("tc1", "calc")),
                    deltas: ["thinking..."],
                },
                { kind: "message", message: assistantText("done"), deltas: ["d", "one"] },
            ],
        });

        const handle = await loop.createTurn({ messages: [userMsg("go")] });
        const types: string[] = [];
        for await (const event of handle.events) types.push(event.type);

        expect(types).toEqual([
            "text-delta",            // thinking...
            "tool-call",
            "finish",
            "tool-execution-start",
            "tool-result",
            "text-delta", "text-delta",
            "finish",
        ]);
        const turn = await handle.result;
        expect(deriveTurnStatus(turn)).toBe("completed");
    });

    it("records one usage fact per model call and derives the turn total", async () => {
        const usage = (inputTokens: number, outputTokens: number): ModelStepUsage => ({
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            reasoningTokens: null,
            cachedInputTokens: null,
        });
        const { loop } = makeLoop({
            steps: [
                {
                    kind: "message",
                    message: assistantToolCalls(toolCall("tc1", "calc")),
                    usage: usage(100, 20),
                },
                { kind: "message", message: assistantText("done"), usage: usage(150, 30) },
            ],
        });

        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;

        expect(turn.modelUsage).toHaveLength(2);
        expect(turn.modelUsage[0]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
        expect(turn.modelUsage[1]).toMatchObject({ inputTokens: 150, outputTokens: 30 });
        expect(turn.modelUsage.every((u) => typeof u.at === "string")).toBe(true);
        expect(totalUsage(turn)).toEqual({
            inputTokens: 250,
            outputTokens: 50,
            totalTokens: 300,
            reasoningTokens: null,
            cachedInputTokens: null,
        });
    });

    it("a model step without reported usage records no usage fact", async () => {
        const { loop } = makeLoop({
            steps: [{ kind: "message", message: assistantText("hi") }],
        });
        const turn = await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(turn.modelUsage).toEqual([]);
        expect(totalUsage(turn).totalTokens).toBeNull();
    });

    it("passes the composed system prompt to the model adapter", async () => {
        const { loop, adapter } = makeLoop({
            steps: [{ kind: "message", message: assistantText("ok") }],
            systemComposer: { async system() { return "SYSTEM PROMPT HERE"; } },
        });
        await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(adapter.lastSystem).toBe("SYSTEM PROMPT HERE");
    });

    it("defaults to no system prompt when no composer is configured", async () => {
        const { loop, adapter } = makeLoop({
            steps: [{ kind: "message", message: assistantText("ok") }],
        });
        await (await loop.createTurn({ messages: [userMsg("go")] })).result;
        expect(adapter.lastSystem).toBeNull();
    });

    it("getTurn returns the persisted turn; unknown ids reject", async () => {
        const { loop } = makeLoop({ steps: [{ kind: "message", message: assistantText("hi") }] });
        const created = await (await loop.createTurn({ messages: [userMsg("hello")] })).result;

        const fetched = await loop.getTurn(created.id);
        expect(fetched).toEqual(created);
        await expect(loop.getTurn("missing")).rejects.toThrow("Turn not found");
    });
});
