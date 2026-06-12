import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
    AssistantMessage,
    Message,
    ToolCallPart,
} from "@x/shared/dist/message.js";
import { AgentLoopImpl } from "../agent-loop/agent-loop.js";
import { EventStream } from "../agent-loop/event-stream.js";
import { InMemoryTurnStore } from "../agent-loop/in-memory-turn-store.js";
import type {
    ModelAdapter,
    ModelStepResult,
    ModelStreamRequest,
} from "../agent-loop/model-adapter.js";
import type { PermissionGate } from "../agent-loop/permission-gate.js";
import type { ToolRunner, ToolRunResult } from "../agent-loop/tool-runner.js";
import {
    AgentLoopTurn,
    deriveTurnStatus,
    type ModelStreamEvent,
} from "../agent-loop/types.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { SessionsImpl } from "./sessions.js";

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
    | { kind: "message"; message: z.infer<typeof AssistantMessage> }
    | { kind: "hang" };

class FakeModelAdapter implements ModelAdapter {
    calls = 0;

    constructor(private steps: ModelStep[]) {}

    stream(req: ModelStreamRequest): EventStream<ModelStreamEvent, ModelStepResult> {
        this.calls++;
        const out = new EventStream<ModelStreamEvent, ModelStepResult>();
        const step = this.steps.shift();
        void (async () => {
            await Promise.resolve();
            if (!step) {
                const error = new Error("FakeModelAdapter: no scripted step left");
                out.fail(error);
                return;
            }
            if (step.kind === "hang") {
                req.signal.addEventListener("abort", () => {
                    out.fail(new Error("aborted"));
                }, { once: true });
                return;
            }
            out.push({ type: "finish", message: step.message });
            out.end({ message: step.message, usage: null });
        })();
        return out;
    }
}

class FakeToolRunner implements ToolRunner {
    ran: string[] = [];

    definitions() {
        return [];
    }

    async run(call: z.infer<typeof ToolCallPart>): Promise<ToolRunResult> {
        this.ran.push(call.toolCallId);
        return { type: "result", value: `ok:${call.toolName}` };
    }
}

class FakePermissionGate implements PermissionGate {
    constructor(private required: (toolName: string) => boolean = () => false) {}

    async check(call: z.infer<typeof ToolCallPart>) {
        return this.required(call.toolName)
            ? { required: true as const, request: { tool: call.toolName } }
            : { required: false as const };
    }

    async classify(): Promise<{ decision: "abstained"; reason: string }> {
        return { decision: "abstained", reason: "unsure" };
    }
}

function makeSessions(opts: { steps?: ModelStep[]; gate?: FakePermissionGate } = {}) {
    const turnStore = new InMemoryTurnStore();
    const sessionStore = new InMemorySessionStore();
    const adapter = new FakeModelAdapter(opts.steps ?? []);
    const runner = new FakeToolRunner();
    const loop = new AgentLoopImpl({
        store: turnStore,
        modelAdapter: adapter,
        toolRunner: runner,
        permissionGate: opts.gate ?? new FakePermissionGate(),
    });
    const sessions = new SessionsImpl({ sessionStore, turnStore, agentLoop: loop });
    return { sessions, loop, turnStore, sessionStore, adapter, runner };
}

function turnFixture(
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
        sessionId: null,
        sessionSeq: null,
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("SessionsImpl", () => {
    it("creates, fetches, and lists sessions with an agent filter", async () => {
        const { sessions } = makeSessions();

        const s1 = await sessions.createSession({ agentId: "a1", title: "first" });
        const s2 = await sessions.createSession({ agentId: "a2" });

        expect(await sessions.getSession(s1.id)).toEqual(s1);
        expect(s2.title).toBeNull();
        expect((await sessions.listSessions()).map((s) => s.id).sort())
            .toEqual([s1.id, s2.id].sort());
        expect(await sessions.listSessions({ agentId: "a1" })).toEqual([s1]);
        await expect(sessions.getSession("missing")).rejects.toThrow("Session not found");
    });

    it("first sendMessage creates turn 1 with session linkage and per-call config", async () => {
        const { sessions } = makeSessions({
            steps: [{ kind: "message", message: assistantText("hi!") }],
        });
        const session = await sessions.createSession({ agentId: "a1" });

        const handle = await sessions.sendMessage(
            session.id,
            [userMsg("hello")],
            { provider: "openai", model: "gpt-x" },
        );
        const turn = await handle.result;

        expect(turn.sessionId).toBe(session.id);
        expect(turn.sessionSeq).toBe(1);
        expect(turn.agentId).toBe("a1"); // stamped from the session
        expect(turn.provider).toBe("openai");
        expect(turn.model).toBe("gpt-x");
        expect(turn.messages).toEqual([userMsg("hello"), assistantText("hi!")]);
        expect(deriveTurnStatus(turn)).toBe("completed");
    });

    it("copies the previous transcript forward into the next turn", async () => {
        const { sessions } = makeSessions({
            steps: [
                { kind: "message", message: assistantText("answer one") },
                { kind: "message", message: assistantText("answer two") },
            ],
        });
        const session = await sessions.createSession();

        await (await sessions.sendMessage(session.id, [userMsg("one")])).result;
        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("two")])).result;

        expect(turn2.sessionSeq).toBe(2);
        expect(turn2.messages).toEqual([
            userMsg("one"),
            assistantText("answer one"),
            userMsg("two"),
            assistantText("answer two"),
        ]);
        expect(await sessions.getHistory(session.id)).toEqual(turn2.messages);
        expect((await sessions.listTurns(session.id)).map((t) => t.sessionSeq)).toEqual([1, 2]);
    });

    it("rejects empty messages and unknown sessions", async () => {
        const { sessions } = makeSessions();
        const session = await sessions.createSession();
        await expect(sessions.sendMessage(session.id, [])).rejects.toThrow();
        await expect(sessions.sendMessage("missing", [userMsg("hi")]))
            .rejects.toThrow("Session not found");
    });

    it("rejects while a turn is in flight; a stopped turn can be superseded", async () => {
        const { sessions, loop } = makeSessions({
            steps: [
                { kind: "hang" },
                { kind: "message", message: assistantText("fresh start") },
            ],
        });
        const session = await sessions.createSession();

        const first = await sessions.sendMessage(session.id, [userMsg("one")]);
        await expect(sessions.sendMessage(session.id, [userMsg("two")]))
            .rejects.toThrow("not finished");

        await loop.stopTurn(first.id); // terminal "stopped" error, nothing partial persisted
        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("two")])).result;

        expect(turn2.sessionSeq).toBe(2);
        expect(turn2.messages).toEqual([
            userMsg("one"), // stopped turn's input is still part of the transcript
            userMsg("two"),
            assistantText("fresh start"),
        ]);
    });

    it("rejects while the latest turn waits on a permission", async () => {
        const { sessions, loop } = makeSessions({
            steps: [
                { kind: "message", message: assistantToolCalls(toolCall("tc1", "write")) },
                { kind: "message", message: assistantText("done") },
                { kind: "message", message: assistantText("next answer") },
            ],
            gate: new FakePermissionGate(() => true),
        });
        const session = await sessions.createSession();

        const first = await sessions.sendMessage(session.id, [userMsg("one")]);
        const waiting = await first.result;
        expect(deriveTurnStatus(waiting)).toBe("waiting");

        await expect(sessions.sendMessage(session.id, [userMsg("two")]))
            .rejects.toThrow("not finished");

        const done = await loop.respondToPermission(waiting.id, "tc1", "granted").result;
        expect(deriveTurnStatus(done)).toBe("completed");

        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("two")])).result;
        expect(turn2.sessionSeq).toBe(2);
    });

    it("a crashed turn blocks the session until stopped; its calls are closed out", async () => {
        const { sessions, loop, turnStore, runner } = makeSessions({
            steps: [{ kind: "message", message: assistantText("moving on") }],
        });
        const session = await sessions.createSession();

        // crafted idle turn (crash): tc1 never evaluated, tc2 started then crashed
        await turnStore.create(turnFixture("t1", {
            sessionId: session.id,
            sessionSeq: 1,
            messages: [userMsg("go"), assistantToolCalls(toolCall("tc1", "calc"), toolCall("tc2", "send-email"))],
            startedTools: [{ toolCallId: "tc2", startedAt: "2026-06-12T00:00:00Z" }],
        }));

        // an idle (crashed) turn must be explicitly resumed or stopped first
        await expect(sessions.sendMessage(session.id, [userMsg("never mind")]))
            .rejects.toThrow("not finished");
        await loop.stopTurn("t1");

        const closures = [
            {
                role: "tool" as const,
                content: "Tool was not executed: the turn was stopped before this call ran.",
                toolCallId: "tc1",
                toolName: "calc",
            },
            {
                role: "tool" as const,
                content: "Tool execution was interrupted before completing. It may or may not have taken effect; do not assume it ran.",
                toolCallId: "tc2",
                toolName: "send-email",
            },
        ];
        // getHistory shows the same closed-out transcript the next turn will use
        expect(await sessions.getHistory(session.id)).toEqual([
            userMsg("go"),
            assistantToolCalls(toolCall("tc1", "calc"), toolCall("tc2", "send-email")),
            ...closures,
        ]);

        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("never mind")])).result;

        expect(runner.ran).toEqual([]); // stale calls are closed out, never executed
        expect(turn2.messages).toEqual([
            userMsg("go"),
            assistantToolCalls(toolCall("tc1", "calc"), toolCall("tc2", "send-email")),
            ...closures,
            userMsg("never mind"),
            assistantText("moving on"),
        ]);
        expect(deriveTurnStatus(turn2)).toBe("completed");
    });

    it("a stopped waiting turn can be superseded; the abandoned call never runs", async () => {
        const { sessions, loop, runner } = makeSessions({
            steps: [
                { kind: "message", message: assistantToolCalls(toolCall("tc1", "write")) },
                { kind: "message", message: assistantText("skipped it") },
            ],
            gate: new FakePermissionGate(() => true),
        });
        const session = await sessions.createSession();

        const waiting = await (await sessions.sendMessage(session.id, [userMsg("one")])).result;
        expect(deriveTurnStatus(waiting)).toBe("waiting");

        await loop.stopTurn(waiting.id); // abandon instead of answering the permission
        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("skip it")])).result;

        expect(runner.ran).toEqual([]);
        expect(turn2.sessionSeq).toBe(2);
        expect(turn2.messages).toEqual([
            userMsg("one"),
            assistantToolCalls(toolCall("tc1", "write")),
            {
                role: "tool",
                content: "Tool was not executed: the turn was stopped before this call ran.",
                toolCallId: "tc1",
                toolName: "write",
            },
            userMsg("skip it"),
            assistantText("skipped it"),
        ]);
    });

    it("a stopped turn's dispatched call is closed out as possibly completed externally", async () => {
        const { sessions, loop, turnStore } = makeSessions({
            steps: [{ kind: "message", message: assistantText("noted") }],
        });
        const session = await sessions.createSession();

        // crafted waiting turn: tc1 was delegated to an external runner
        // (pending), then the user stopped the turn before the result arrived
        await turnStore.create(turnFixture("t1", {
            sessionId: session.id,
            sessionSeq: 1,
            messages: [userMsg("run the job"), assistantToolCalls(toolCall("tc1", "background-job"))],
            startedTools: [{ toolCallId: "tc1", startedAt: "2026-06-12T00:00:00Z" }],
            dispatchedTools: [{ toolCallId: "tc1", dispatchedAt: "2026-06-12T00:00:01Z" }],
        }));
        await loop.stopTurn("t1");

        const closure = {
            role: "tool" as const,
            content: "Tool was dispatched but its result never arrived; it may have completed externally. Do not assume it ran or that it failed.",
            toolCallId: "tc1",
            toolName: "background-job",
        };
        const history = await sessions.getHistory(session.id);
        expect(history[history.length - 1]).toEqual(closure);

        // the next turn carries the same closure forward
        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("ok")])).result;
        expect(turn2.messages).toEqual([...history, userMsg("ok"), assistantText("noted")]);
    });

    it("builds on an errored turn's persisted transcript", async () => {
        const { sessions, turnStore } = makeSessions({
            steps: [{ kind: "message", message: assistantText("recovered") }],
        });
        const session = await sessions.createSession();

        await turnStore.create(turnFixture("t1", {
            sessionId: session.id,
            sessionSeq: 1,
            messages: [userMsg("go")],
            error: { message: "rate limited", at: "2026-06-12T00:00:00Z" },
        }));

        const turn2 = await (await sessions.sendMessage(session.id, [userMsg("retry")])).result;
        expect(turn2.sessionSeq).toBe(2);
        expect(turn2.messages).toEqual([userMsg("go"), userMsg("retry"), assistantText("recovered")]);
        // the errored turn is untouched — error is terminal per turn, not per session
        expect((await turnStore.get("t1"))?.error?.message).toBe("rate limited");
    });

    it("serializes concurrent sends: exactly one wins while a turn is in flight", async () => {
        const { sessions } = makeSessions({ steps: [{ kind: "hang" }] });
        const session = await sessions.createSession();

        const [a, b] = await Promise.allSettled([
            sessions.sendMessage(session.id, [userMsg("one")]),
            sessions.sendMessage(session.id, [userMsg("two")]),
        ]);

        expect(a.status).toBe("fulfilled");
        expect(b.status).toBe("rejected");
        const latest = await sessions.getHistory(session.id);
        expect(latest).toEqual([userMsg("one")]);
    });

    it("sendMessage bumps the session's recency for listSessions ordering", async () => {
        const { sessions } = makeSessions({
            steps: [{ kind: "message", message: assistantText("hi") }],
        });
        const s1 = await sessions.createSession();
        await sleep(10);
        const s2 = await sessions.createSession();
        expect((await sessions.listSessions()).map((s) => s.id)).toEqual([s2.id, s1.id]);

        await sleep(10);
        await (await sessions.sendMessage(s1.id, [userMsg("hello")])).result;
        expect((await sessions.listSessions()).map((s) => s.id)).toEqual([s1.id, s2.id]);
    });
});
