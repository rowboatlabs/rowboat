import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { SessionBusEvent, SessionEvent } from "@x/shared/dist/sessions.js";
import type {
    ResolvedAgent,
    TurnEvent,
    TurnStreamEvent,
} from "@x/shared/dist/turns.js";
import type {
    CreateTurnInput,
    ITurnRuntime,
    Turn,
    TurnExecution,
    TurnExternalInput,
    TurnOutcome,
} from "../turns/api.js";
import { TurnInputError } from "../turns/api.js";
import { HotStream } from "../turns/stream.js";
import { TurnNotSettledError } from "./api.js";
import { runHeadlessTurn } from "./headless.js";
import { InMemorySessionRepo } from "./in-memory-session-repo.js";
import type { ISessionRepo } from "./repo.js";
import { SessionsImpl } from "./sessions.js";

type TEvent = z.infer<typeof TurnEvent>;

const TS = "2026-07-02T10:00:00Z";
const FIXTURE_MODEL = { provider: "openai", model: "gpt-fixture" };
const FIXTURE_AGENT: z.infer<typeof ResolvedAgent> = {
    agentId: "copilot",
    systemPrompt: "SYS",
    model: FIXTURE_MODEL,
    tools: [],
};

function user(text: string) {
    return { role: "user" as const, content: text };
}

function assistantText(text: string) {
    return { role: "assistant" as const, content: text };
}

function completedOutcome(): TurnOutcome {
    return {
        status: "completed",
        output: assistantText("ok"),
        finishReason: "stop",
        usage: {},
    };
}

function createdEvent(turnId: string, input: CreateTurnInput): TEvent {
    return {
        type: "turn_created",
        schemaVersion: 1,
        turnId,
        ts: TS,
        sessionId: input.sessionId ?? null,
        agent: { requested: input.agent, resolved: FIXTURE_AGENT },
        context: input.context,
        input: input.input,
        config: {
            autoPermission: input.config.autoPermission ?? false,
            humanAvailable: input.config.humanAvailable,
            maxModelCalls: input.config.maxModelCalls ?? 20,
        },
    };
}

// Minimal valid event logs reducing to each turn status.
function turnLog(
    turnId: string,
    sessionId: string,
    status: "idle" | "completed" | "failed" | "cancelled" | "suspended",
): TEvent[] {
    const created: TEvent = createdEvent(turnId, {
        agent: { agentId: "copilot" },
        sessionId,
        context: [],
        input: user("hi"),
        config: { humanAvailable: true },
    });
    const requested: TEvent = {
        type: "model_call_requested",
        turnId,
        ts: TS,
        modelCallIndex: 0,
        request: { messages: ['input'], parameters: {} },
    };
    switch (status) {
        case "idle":
            return [created];
        case "completed":
            return [
                created,
                requested,
                {
                    type: "model_call_completed",
                    turnId,
                    ts: TS,
                    modelCallIndex: 0,
                    message: assistantText("ok"),
                    finishReason: "stop",
                    usage: {},
                },
                {
                    type: "turn_completed",
                    turnId,
                    ts: TS,
                    output: assistantText("ok"),
                    finishReason: "stop",
                    usage: {},
                },
            ];
        case "failed":
            return [
                created,
                requested,
                { type: "model_call_failed", turnId, ts: TS, modelCallIndex: 0, error: "boom" },
                { type: "turn_failed", turnId, ts: TS, error: "boom", usage: {} },
            ];
        case "cancelled":
            return [
                created,
                { type: "turn_cancelled", turnId, ts: TS, usage: {} },
            ];
        case "suspended":
            return [
                created,
                requested,
                {
                    type: "model_call_completed",
                    turnId,
                    ts: TS,
                    modelCallIndex: 0,
                    message: {
                        role: "assistant",
                        content: [
                            {
                                type: "tool-call",
                                toolCallId: "B",
                                toolName: "fetch",
                                arguments: {},
                            },
                        ],
                    },
                    finishReason: "tool-calls",
                    usage: {},
                },
                {
                    type: "tool_invocation_requested",
                    turnId,
                    ts: TS,
                    toolCallId: "B",
                    toolId: "tool.fetch",
                    toolName: "fetch",
                    execution: "async",
                    input: {},
                },
                {
                    type: "turn_suspended",
                    turnId,
                    ts: TS,
                    pendingPermissions: [],
                    pendingAsyncTools: [
                        { toolCallId: "B", toolId: "tool.fetch", toolName: "fetch", input: {} },
                    ],
                    usage: {},
                },
            ];
    }
}

type AdvanceScript = (call: {
    turnId: string;
    input?: TurnExternalInput;
    signal?: AbortSignal;
}) =>
    | { events?: TurnStreamEvent[]; outcome: TurnOutcome }
    | { error: unknown }
    | { untilAbort: true };

class FakeTurnRuntime implements ITurnRuntime {
    createTurnInputs: CreateTurnInput[] = [];
    advanceCalls: Array<{ turnId: string; input?: TurnExternalInput }> = [];
    logs = new Map<string, TEvent[]>();
    createError?: Error;
    script?: AdvanceScript;
    // When set, session turns get an inherited agent snapshot (like the real
    // runtime does for identical predecessors).
    inheritSnapshots = false;
    private n = 0;

    async createTurn(input: CreateTurnInput): Promise<string> {
        if (this.createError) {
            throw this.createError;
        }
        this.createTurnInputs.push(input);
        this.n += 1;
        const turnId = `2026-07-02T10-00-00Z-${String(this.n).padStart(7, "0")}-000`;
        const created = createdEvent(turnId, input);
        if (
            this.inheritSnapshots &&
            created.type === "turn_created" &&
            !Array.isArray(input.context)
        ) {
            created.agent = {
                ...created.agent,
                resolved: {
                    agentId: FIXTURE_AGENT.agentId,
                    model: FIXTURE_MODEL,
                    inheritedFrom: input.context.previousTurnId,
                },
            };
        }
        this.logs.set(turnId, [created]);
        return turnId;
    }

    advanceTurn(
        turnId: string,
        input?: TurnExternalInput,
        options?: { signal?: AbortSignal },
    ): TurnExecution {
        this.advanceCalls.push({ turnId, input });
        const stream = new HotStream<TurnStreamEvent, TurnOutcome>();
        const result = this.script?.({ turnId, input, signal: options?.signal }) ?? {
            outcome: completedOutcome(),
        };
        if ("error" in result) {
            stream.fail(result.error);
        } else if ("untilAbort" in result) {
            const signal = options?.signal;
            if (!signal) {
                throw new Error("untilAbort script requires a signal");
            }
            const finish = () => stream.end({ status: "cancelled", usage: {} });
            if (signal.aborted) {
                finish();
            } else {
                signal.addEventListener("abort", finish, { once: true });
            }
        } else {
            for (const event of result.events ?? []) {
                stream.push(event);
            }
            stream.end(result.outcome);
        }
        return { events: stream.events, outcome: stream.outcome };
    }

    async getTurn(turnId: string): Promise<Turn> {
        const log = this.logs.get(turnId);
        if (!log) {
            throw new Error(`turn not found: ${turnId}`);
        }
        return { turnId, events: structuredClone(log) };
    }

    setLog(turnId: string, events: TEvent[]): void {
        this.logs.set(turnId, events);
    }
}

class RecordingBus {
    events: SessionBusEvent[] = [];
    publish(event: SessionBusEvent): void {
        this.events.push(event);
    }
}

class FakeIdGen {
    private n = 0;
    async next(): Promise<string> {
        this.n += 1;
        return `2026-07-02T09-00-00Z-${String(this.n).padStart(7, "0")}-000`;
    }
}

class FakeClock {
    now(): string {
        return TS;
    }
}

// Wrapper to simulate a crash between turn-file creation and session append.
class FlakySessionRepo implements ISessionRepo {
    failNextAppend = false;
    constructor(private readonly inner: InMemorySessionRepo) {}
    create(event: Parameters<InMemorySessionRepo["create"]>[0]) {
        return this.inner.create(event);
    }
    read(sessionId: string) {
        return this.inner.read(sessionId);
    }
    async append(
        sessionId: string,
        events: Array<z.infer<typeof SessionEvent>>,
    ): Promise<void> {
        if (this.failNextAppend) {
            this.failNextAppend = false;
            throw new Error("disk full");
        }
        return this.inner.append(sessionId, events);
    }
    withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
        return this.inner.withLock(sessionId, fn);
    }
    listSessionIds() {
        return this.inner.listSessionIds();
    }
    delete(sessionId: string) {
        return this.inner.delete(sessionId);
    }
}

function makeSessions(opts: { repo?: ISessionRepo; fake?: FakeTurnRuntime } = {}) {
    const repo = opts.repo ?? new InMemorySessionRepo();
    const fake = opts.fake ?? new FakeTurnRuntime();
    const bus = new RecordingBus();
    const sessions = new SessionsImpl({
        sessionRepo: repo,
        turnRuntime: fake,
        idGenerator: new FakeIdGen(),
        clock: new FakeClock(),
        sessionBus: bus,
    });
    return { sessions, repo, fake, bus };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createSession and listing", () => {
    it("persists session_created and publishes an index entry with status none", async () => {
        const { sessions, repo, bus } = makeSessions();
        const sessionId = await sessions.createSession({ title: "My chat" });
        const events = await (repo as InMemorySessionRepo).read(sessionId);
        expect(events).toEqual([
            expect.objectContaining({
                type: "session_created",
                schemaVersion: 1,
                sessionId,
                title: "My chat",
            }),
        ]);
        expect(sessions.listSessions()).toEqual([
            expect.objectContaining({
                sessionId,
                title: "My chat",
                turnCount: 0,
                latestTurnStatus: "none",
            }),
        ]);
        expect(bus.events).toEqual([
            expect.objectContaining({ kind: "index-changed", sessionId }),
        ]);
    });
});

describe("sendMessage (13.3)", () => {
    it("first message: inline empty context, config on the turn, denormalized ref, default title", async () => {
        const { sessions, repo, fake } = makeSessions();
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("Fix the bug in parser"), {
            agent: { agentId: "copilot", overrides: { model: { provider: "x", model: "y" } } },
            autoPermission: true,
            maxModelCalls: 5,
        });

        expect(fake.createTurnInputs[0]).toEqual({
            agent: { agentId: "copilot", overrides: { model: { provider: "x", model: "y" } } },
            sessionId,
            context: [],
            input: user("Fix the bug in parser"),
            config: { humanAvailable: true, autoPermission: true, maxModelCalls: 5 },
        });

        const events = await (repo as InMemorySessionRepo).read(sessionId);
        expect(events[1]).toEqual(
            expect.objectContaining({
                type: "turn_appended",
                turnId,
                sessionSeq: 1,
                agentId: "copilot",
                model: FIXTURE_MODEL, // resolved, not requested override input
            }),
        );
        expect(events[2]).toEqual(
            expect.objectContaining({
                type: "title_changed",
                title: "Fix the bug in parser",
            }),
        );
        expect(fake.advanceCalls).toEqual([{ turnId, input: undefined }]);
    });

    it("subsequent messages reference the latest turn and skip the title", async () => {
        const { sessions, repo, fake } = makeSessions();
        const sessionId = await sessions.createSession();
        const first = await sessions.sendMessage(sessionId, user("one"), {
            agent: { agentId: "copilot" },
        });
        fake.setLog(first.turnId, turnLog(first.turnId, sessionId, "completed"));

        const second = await sessions.sendMessage(sessionId, user("two"), {
            agent: { agentId: "copilot" },
        });
        expect(fake.createTurnInputs[1].context).toEqual({
            previousTurnId: first.turnId,
        });
        const events = await (repo as InMemorySessionRepo).read(sessionId);
        const appends = events.filter((e) => e.type === "turn_appended");
        expect(appends.map((e) => (e.type === "turn_appended" ? e.sessionSeq : 0))).toEqual([1, 2]);
        expect(appends[1]).toEqual(
            expect.objectContaining({ turnId: second.turnId }),
        );
        expect(events.filter((e) => e.type === "title_changed")).toHaveLength(1);
    });

    it("rejects while the latest turn is idle or suspended; allows all terminal statuses", async () => {
        const { sessions, fake } = makeSessions();
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("one"), {
            agent: { agentId: "copilot" },
        });

        for (const status of ["idle", "suspended"] as const) {
            fake.setLog(turnId, turnLog(turnId, sessionId, status));
            const attempt = sessions.sendMessage(sessionId, user("nope"), {
                agent: { agentId: "copilot" },
            });
            await expect(attempt).rejects.toThrowError(TurnNotSettledError);
            await expect(attempt).rejects.toMatchObject({
                sessionId,
                turnId,
                turnStatus: status,
            });
        }

        let latest = turnId;
        for (const status of ["completed", "failed", "cancelled"] as const) {
            fake.setLog(latest, turnLog(latest, sessionId, status));
            const result = await sessions.sendMessage(sessionId, user(`after ${status}`), {
                agent: { agentId: "copilot" },
            });
            latest = result.turnId;
        }
    });

    it("denormalizes the model correctly for inherited agent snapshots", async () => {
        const { sessions, repo, fake } = makeSessions();
        fake.inheritSnapshots = true;
        const sessionId = await sessions.createSession();
        const first = await sessions.sendMessage(sessionId, user("one"), {
            agent: { agentId: "copilot" },
        });
        fake.setLog(first.turnId, turnLog(first.turnId, sessionId, "completed"));

        const second = await sessions.sendMessage(sessionId, user("two"), {
            agent: { agentId: "copilot" },
        });
        // The second turn's created event carries an inherited snapshot; the
        // session still denormalizes the concrete model onto turn_appended,
        // and status derivation reduces the inherited log fine.
        const created = fake.logs.get(second.turnId)?.[0];
        expect(
            created?.type === "turn_created" && "inheritedFrom" in created.agent.resolved,
        ).toBe(true);
        const events = await (repo as InMemorySessionRepo).read(sessionId);
        const appended = events.filter((e) => e.type === "turn_appended");
        expect(appended[1]).toMatchObject({ model: FIXTURE_MODEL });
        expect(sessions.listSessions()[0].lastModel).toEqual(FIXTURE_MODEL);
    });

    it("serializes concurrent sends: exactly one wins", async () => {
        const { sessions, repo } = makeSessions();
        const sessionId = await sessions.createSession();
        const results = await Promise.allSettled([
            sessions.sendMessage(sessionId, user("a"), { agent: { agentId: "copilot" } }),
            sessions.sendMessage(sessionId, user("b"), { agent: { agentId: "copilot" } }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected");
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
            TurnNotSettledError,
        );
        const events = await (repo as InMemorySessionRepo).read(sessionId);
        expect(events.filter((e) => e.type === "turn_appended")).toHaveLength(1);
    });
});

describe("write ordering and crash simulation (13.4)", () => {
    it("a failed session append leaves a benign orphan turn and no advance; retry works", async () => {
        const inner = new InMemorySessionRepo();
        const flaky = new FlakySessionRepo(inner);
        const { sessions, fake } = makeSessions({ repo: flaky });
        const sessionId = await sessions.createSession();

        flaky.failNextAppend = true;
        await expect(
            sessions.sendMessage(sessionId, user("one"), { agent: { agentId: "copilot" } }),
        ).rejects.toThrowError("disk full");

        // Turn file exists (orphan), session unchanged, nothing advanced.
        expect(fake.logs.size).toBe(1);
        expect(fake.advanceCalls).toHaveLength(0);
        expect(await inner.read(sessionId)).toHaveLength(1);

        // Retry produces a fresh turn at sessionSeq 1.
        const { turnId } = await sessions.sendMessage(sessionId, user("one again"), {
            agent: { agentId: "copilot" },
        });
        const events = await inner.read(sessionId);
        expect(events.filter((e) => e.type === "turn_appended")).toEqual([
            expect.objectContaining({ turnId, sessionSeq: 1 }),
        ]);
    });

    it("a failed createTurn leaves the session untouched", async () => {
        const { sessions, repo, fake } = makeSessions();
        const sessionId = await sessions.createSession();
        fake.createError = new Error("agent resolution failed");
        await expect(
            sessions.sendMessage(sessionId, user("one"), { agent: { agentId: "ghost" } }),
        ).rejects.toThrowError("agent resolution failed");
        expect(await (repo as InMemorySessionRepo).read(sessionId)).toHaveLength(1);
        expect(fake.advanceCalls).toHaveLength(0);
    });
});

describe("external input routing (13.5)", () => {
    async function setupSuspended() {
        const fixture = makeSessions();
        const sessionId = await fixture.sessions.createSession();
        const { turnId } = await fixture.sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        fixture.fake.setLog(turnId, turnLog(turnId, sessionId, "suspended"));
        fixture.fake.advanceCalls.length = 0;
        return { ...fixture, sessionId, turnId };
    }

    it("respondToPermission advances with a permission_decision input", async () => {
        const { sessions, fake, turnId } = await setupSuspended();
        await sessions.respondToPermission(turnId, "tc1", "allow", { scope: "once" });
        expect(fake.advanceCalls).toEqual([
            {
                turnId,
                input: {
                    type: "permission_decision",
                    toolCallId: "tc1",
                    decision: "allow",
                    metadata: { scope: "once" },
                },
            },
        ]);
    });

    it("respondToAskHuman is a dedicated async_tool_result wrapper", async () => {
        const { sessions, fake, turnId } = await setupSuspended();
        await sessions.respondToAskHuman(turnId, "B", "the answer is 42");
        expect(fake.advanceCalls).toEqual([
            {
                turnId,
                input: {
                    type: "async_tool_result",
                    toolCallId: "B",
                    result: { output: "the answer is 42", isError: false },
                },
            },
        ]);
    });

    it("deliverAsyncToolResult passes the result through verbatim", async () => {
        const { sessions, fake, turnId } = await setupSuspended();
        await sessions.deliverAsyncToolResult(turnId, "B", {
            output: { rows: 3 },
            isError: false,
        });
        expect(fake.advanceCalls[0].input).toEqual({
            type: "async_tool_result",
            toolCallId: "B",
            result: { output: { rows: 3 }, isError: false },
        });
    });

    it("turn-runtime input rejections pass through", async () => {
        const { sessions, fake, turnId } = await setupSuspended();
        fake.script = () => ({ error: new TurnInputError("no pending async tool call X") });
        await expect(
            sessions.deliverAsyncToolResult(turnId, "X", { output: "x", isError: false }),
        ).rejects.toThrowError(TurnInputError);
    });
});

describe("stopTurn and resumeTurn", () => {
    it("aborts an actively running advance instead of issuing a cancel input", async () => {
        const { sessions, fake } = makeSessions();
        fake.script = () => ({ untilAbort: true });
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        expect(fake.advanceCalls).toHaveLength(1);
        await sessions.stopTurn(turnId);
        // No second advance: the running invocation's signal was aborted.
        expect(fake.advanceCalls).toHaveLength(1);
    });

    it("cancels an at-rest turn through a cancel input", async () => {
        const { sessions, fake } = makeSessions();
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        await flush();
        fake.setLog(turnId, turnLog(turnId, sessionId, "suspended"));
        fake.advanceCalls.length = 0;
        await sessions.stopTurn(turnId, "user stop");
        expect(fake.advanceCalls).toEqual([
            { turnId, input: { type: "cancel", reason: "user stop" } },
        ]);
    });

    it("resumeTurn re-enters the latest turn with no input", async () => {
        const { sessions, fake } = makeSessions();
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        await flush();
        fake.advanceCalls.length = 0;
        await sessions.resumeTurn(sessionId);
        expect(fake.advanceCalls).toEqual([{ turnId, input: undefined }]);
    });

    it("resumeTurn on a session with no turns throws", async () => {
        const { sessions } = makeSessions();
        const sessionId = await sessions.createSession();
        await expect(sessions.resumeTurn(sessionId)).rejects.toThrowError(
            /no turns to resume/,
        );
    });
});

describe("event forwarding and index maintenance (13.6, 13.7)", () => {
    it("forwards stream events to the bus tagged with sessionId in order", async () => {
        const { sessions, fake, bus } = makeSessions();
        const streamed: TurnStreamEvent[] = [
            { type: "text_delta", turnId: "x", modelCallIndex: 0, delta: "he" },
            { type: "text_delta", turnId: "x", modelCallIndex: 0, delta: "y" },
        ];
        fake.script = () => ({ events: streamed, outcome: completedOutcome() });
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        await flush();
        const turnEvents = bus.events.filter((e) => e.kind === "turn-event");
        expect(turnEvents).toEqual(
            streamed.map((event) => ({
                kind: "turn-event",
                sessionId,
                turnId,
                event,
            })),
        );
    });

    it("outcome settlement updates the index entry's latest turn status", async () => {
        const { sessions, fake, bus } = makeSessions();
        fake.script = () => ({
            outcome: {
                status: "suspended",
                pendingPermissions: [],
                pendingAsyncTools: [
                    { toolCallId: "B", toolId: "tool.fetch", toolName: "fetch", input: {} },
                ],
                usage: {},
            },
        });
        const sessionId = await sessions.createSession();
        await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        await flush();
        expect(sessions.listSessions()[0].latestTurnStatus).toBe("suspended");
        const last = bus.events[bus.events.length - 1];
        expect(last).toMatchObject({
            kind: "index-changed",
            entry: { latestTurnStatus: "suspended" },
        });
    });

    it("setTitle appends and updates the index preserving status", async () => {
        const { sessions, repo } = makeSessions();
        const sessionId = await sessions.createSession();
        await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });
        await flush();
        await sessions.setTitle(sessionId, "Renamed");
        const events = await (repo as InMemorySessionRepo).read(sessionId);
        expect(events[events.length - 1]).toMatchObject({
            type: "title_changed",
            title: "Renamed",
        });
        expect(sessions.listSessions()[0]).toMatchObject({
            title: "Renamed",
            latestTurnStatus: "completed",
        });
    });

    it("deleteSession removes the file and entry; turn files stay; late settles don't resurrect", async () => {
        const { sessions, repo, fake, bus } = makeSessions();
        fake.script = () => ({ untilAbort: true });
        const sessionId = await sessions.createSession();
        const { turnId } = await sessions.sendMessage(sessionId, user("go"), {
            agent: { agentId: "copilot" },
        });

        await sessions.deleteSession(sessionId);
        await expect(
            (repo as InMemorySessionRepo).read(sessionId),
        ).rejects.toThrowError(/session not found/);
        expect(sessions.listSessions()).toEqual([]);
        expect(bus.events[bus.events.length - 1]).toEqual({
            kind: "index-changed",
            sessionId,
            entry: null,
        });
        // Turn file untouched (orphaned, inert).
        expect(fake.logs.has(turnId)).toBe(true);

        // The still-running advance settles after deletion: no resurrection.
        await sessions.stopTurn(turnId);
        await flush();
        expect(sessions.listSessions()).toEqual([]);
    });
});

describe("startup scan (13.6)", () => {
    it("builds the index from session files and each latest turn; corrupt files yield errored entries", async () => {
        const repo = new InMemorySessionRepo();
        const fake = new FakeTurnRuntime();
        const s1 = "2026-07-02T09-00-00Z-0000001-000";
        const s2 = "2026-07-02T09-00-00Z-0000002-000";
        const s3 = "2026-07-02T09-00-00Z-0000003-000";
        repo.seed([
            { type: "session_created", schemaVersion: 1, sessionId: s1, ts: TS, title: "Done one" },
            {
                type: "turn_appended",
                sessionId: s1,
                ts: TS,
                turnId: "t1",
                sessionSeq: 1,
                agentId: "copilot",
                model: FIXTURE_MODEL,
            },
        ]);
        fake.setLog("t1", turnLog("t1", s1, "completed"));
        repo.seed([
            { type: "session_created", schemaVersion: 1, sessionId: s2, ts: TS },
            {
                type: "turn_appended",
                sessionId: s2,
                ts: TS,
                turnId: "t2",
                sessionSeq: 1,
                agentId: "researcher",
                model: { provider: "anthropic", model: "claude-x" },
            },
        ]);
        fake.setLog("t2", turnLog("t2", s2, "suspended"));
        repo.seedCorrupt(s3);

        const { sessions } = makeSessions({ repo, fake });
        await sessions.initialize();

        const entries = sessions.listSessions();
        expect(entries).toHaveLength(3);
        const byId = new Map(entries.map((e) => [e.sessionId, e]));
        expect(byId.get(s1)).toMatchObject({
            title: "Done one",
            turnCount: 1,
            lastAgentId: "copilot",
            lastModel: FIXTURE_MODEL,
            latestTurnStatus: "completed",
        });
        expect(byId.get(s2)).toMatchObject({
            lastAgentId: "researcher",
            latestTurnStatus: "suspended",
        });
        expect(byId.get(s3)).toMatchObject({
            latestTurnStatus: "none",
            error: expect.stringMatching(/corrupt/),
        });
    });

    it("a rebuilt index matches write-through state for the same history", async () => {
        const repo = new InMemorySessionRepo();
        const fake = new FakeTurnRuntime();
        const live = makeSessions({ repo, fake });
        const sessionId = await live.sessions.createSession();
        const { turnId } = await live.sessions.sendMessage(sessionId, user("hello world"), {
            agent: { agentId: "copilot" },
        });
        await flush();
        fake.setLog(turnId, turnLog(turnId, sessionId, "completed"));

        const rebuilt = makeSessions({ repo, fake });
        await rebuilt.sessions.initialize();
        expect(rebuilt.sessions.listSessions()).toEqual([
            expect.objectContaining({
                sessionId,
                title: "hello world",
                turnCount: 1,
                latestTurnId: turnId,
                latestTurnStatus: "completed",
            }),
        ]);
    });
});

describe("headless standalone turns (13.8)", () => {
    it("runs a standalone turn with sessionId null, auto permission, no human", async () => {
        const fake = new FakeTurnRuntime();
        const { turnId, outcome } = await runHeadlessTurn(fake, {
            agent: { agentId: "background-task-agent" },
            input: user("summarize"),
            maxModelCalls: 3,
        });
        expect(fake.createTurnInputs[0]).toEqual({
            agent: { agentId: "background-task-agent" },
            sessionId: null,
            context: [],
            input: user("summarize"),
            config: { autoPermission: true, humanAvailable: false, maxModelCalls: 3 },
        });
        expect(outcome.status).toBe("completed");
        expect(fake.advanceCalls).toEqual([{ turnId, input: undefined }]);
    });
});
