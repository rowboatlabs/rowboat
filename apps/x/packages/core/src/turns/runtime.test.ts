import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
    MODEL_CALL_LIMIT_ERROR_CODE,
    type JsonValue,
    type ResolvedAgent,
    type ToolDescriptor,
    type TurnBusEvent,
    type TurnEvent,
    type TurnStreamEvent,
    isDurableTurnEvent,
    reduceTurn,
} from "@x/shared/dist/turns.js";
import type { IAgentResolver } from "./agent-resolver.js";
import type { TurnExecution, TurnOutcome } from "./api.js";
import { TurnDependencyError, TurnInputError } from "./api.js";
import type { TurnLifecycleEvent } from "./bus.js";
import { TurnRepoContextResolver } from "./context-resolver.js";
import { InMemoryTurnRepo } from "./in-memory-turn-repo.js";
import type {
    IModelRegistry,
    LlmStreamEvent,
    ModelStreamRequest,
    ResolvedModel,
} from "./model-registry.js";
import type {
    IPermissionChecker,
    IPermissionClassifier,
    PermissionCheckInput,
    PermissionClassification,
    PermissionClassificationBatch,
    PermissionClassificationInput,
} from "./permission.js";
import { composeModelRequest } from "./compose-model-request.js";
import { TurnRuntime } from "./runtime.js";
import type {
    IToolRegistry,
    RuntimeTool,
    SyncRuntimeTool,
    ToolExecutionContext,
} from "./tool-registry.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TS = "2026-07-02T10:00:00Z";

const echoDescriptor: z.infer<typeof ToolDescriptor> = {
    toolId: "tool.echo",
    name: "echo",
    description: "Echo tool",
    inputSchema: {},
    execution: "sync",
    requiresHuman: false,
};

const fetchDescriptor: z.infer<typeof ToolDescriptor> = {
    toolId: "tool.fetch",
    name: "fetch",
    description: "Async fetch tool",
    inputSchema: {},
    execution: "async",
    requiresHuman: false,
};

const askHumanDescriptor: z.infer<typeof ToolDescriptor> = {
    toolId: "tool.ask-human",
    name: "ask-human",
    description: "Ask the human",
    inputSchema: {},
    execution: "async",
    requiresHuman: true,
};

const defaultAgent: z.infer<typeof ResolvedAgent> = {
    agentId: "copilot",
    systemPrompt: "SYS",
    model: { provider: "fake", model: "m" },
    tools: [echoDescriptor, fetchDescriptor, askHumanDescriptor],
};

function user(text: string) {
    return { role: "user" as const, content: text };
}

function assistantText(text: string) {
    return { role: "assistant" as const, content: text };
}

function toolCallPart(id: string, name: string, args: JsonValue = {}) {
    return {
        type: "tool-call" as const,
        toolCallId: id,
        toolName: name,
        arguments: args,
    };
}

function assistantCalls(...parts: Array<ReturnType<typeof toolCallPart>>) {
    return { role: "assistant" as const, content: parts };
}

function completedResp(
    message: Extract<LlmStreamEvent, { type: "completed" }>["message"],
): LlmStreamEvent {
    return {
        type: "completed",
        message,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
}

type ScriptedCall = (
    request: ModelStreamRequest,
) => AsyncGenerator<LlmStreamEvent, void, void>;

function respond(...events: LlmStreamEvent[]): ScriptedCall {
    return async function* () {
        yield* events;
    };
}

function failCall(error: string): ScriptedCall {
    // eslint-disable-next-line require-yield
    return async function* () {
        throw new Error(error);
    };
}

function hangUntilAbort(onStarted?: () => void): ScriptedCall {
    // eslint-disable-next-line require-yield
    return async function* (request) {
        onStarted?.();
        await new Promise<void>((resolve) => {
            if (request.signal.aborted) {
                resolve();
            } else {
                request.signal.addEventListener("abort", () => resolve(), {
                    once: true,
                });
            }
        });
        throw new Error("aborted");
    };
}

class FakeModelRegistry implements IModelRegistry {
    requests: ModelStreamRequest[] = [];
    resolved: Array<ResolvedModel["descriptor"]> = [];
    private next = 0;

    constructor(private readonly calls: ScriptedCall[]) {}

    async resolve(
        descriptor: ResolvedModel["descriptor"],
    ): Promise<ResolvedModel> {
        this.resolved.push(descriptor);
        return {
            descriptor,
            // Identity encoding: tests assert on structural messages directly.
            encodeMessages: (messages) => messages as unknown as JsonValue[],
            stream: (request) => {
                this.requests.push(request);
                const call = this.calls[this.next++];
                if (!call) {
                    throw new Error("no scripted model call remaining");
                }
                return call(request);
            },
        };
    }
}

function syncTool(
    descriptor: z.infer<typeof ToolDescriptor>,
    execute: SyncRuntimeTool["execute"],
): SyncRuntimeTool {
    return {
        descriptor: descriptor as SyncRuntimeTool["descriptor"],
        execute,
    };
}

const defaultTools: RuntimeTool[] = [
    syncTool(echoDescriptor, async (input) => ({
        output: { echoed: (input ?? null) as JsonValue },
        isError: false,
    })),
    { descriptor: fetchDescriptor as { execution: "async" } & typeof fetchDescriptor },
    { descriptor: askHumanDescriptor as { execution: "async" } & typeof askHumanDescriptor },
];

class FakeToolRegistry implements IToolRegistry {
    constructor(private readonly tools: RuntimeTool[]) {}

    async resolve(
        descriptor: z.infer<typeof ToolDescriptor>,
    ): Promise<RuntimeTool> {
        const tool = this.tools.find(
            (t) => t.descriptor.toolId === descriptor.toolId,
        );
        if (!tool) {
            throw new TurnDependencyError(`no live tool for ${descriptor.toolId}`);
        }
        return tool;
    }
}

type CheckerRule = "allow" | { request: JsonValue } | "throw";

class FakePermissionChecker implements IPermissionChecker {
    calls: PermissionCheckInput[] = [];

    constructor(private readonly rules: Record<string, CheckerRule> = {}) {}

    async check(input: PermissionCheckInput) {
        this.calls.push(input);
        const rule = this.rules[input.toolName] ?? "allow";
        if (rule === "allow") {
            return { required: false as const };
        }
        if (rule === "throw") {
            throw new Error("checker exploded");
        }
        return { required: true as const, request: rule.request };
    }
}

class FakePermissionClassifier implements IPermissionClassifier {
    batches: PermissionClassificationInput[][] = [];
    contexts: Array<{ turnId: string; messageCount: number }> = [];

    constructor(
        private readonly impl?: (
            requests: PermissionClassificationInput[],
        ) => PermissionClassification[],
        private readonly throws?: string,
    ) {}

    async classify(
        batch: PermissionClassificationBatch,
    ): Promise<PermissionClassification[]> {
        this.batches.push(batch.requests);
        this.contexts.push({
            turnId: batch.turnId,
            messageCount: batch.messages.length,
        });
        if (this.throws) {
            throw new Error(this.throws);
        }
        if (!this.impl) {
            throw new Error("classifier must not be called in this test");
        }
        return this.impl(batch.requests);
    }
}

class FakeAgentResolver implements IAgentResolver {
    constructor(
        private readonly agent: z.infer<typeof ResolvedAgent>,
        private readonly error?: string,
    ) {}

    async resolve() {
        if (this.error) {
            throw new Error(this.error);
        }
        return this.agent;
    }
}

class FakeBus {
    events: TurnLifecycleEvent[] = [];
    publish(event: TurnLifecycleEvent): void {
        this.events.push(event);
    }
}

class FakeTurnEventBus {
    events: TurnBusEvent[] = [];
    publish(event: TurnBusEvent): void {
        this.events.push(event);
    }
}

class FakeIdGen {
    private n: number;
    constructor(start = 0) {
        this.n = start;
    }
    async next(): Promise<string> {
        this.n += 1;
        return `2026-07-02T10-00-00Z-${String(this.n).padStart(7, "0")}-000`;
    }
}

class FakeClock {
    now(): string {
        return TS;
    }
}

function makeRuntime(opts: {
    models?: ScriptedCall[];
    tools?: RuntimeTool[];
    checker?: FakePermissionChecker;
    classifier?: FakePermissionClassifier;
    agent?: z.infer<typeof ResolvedAgent>;
    agentError?: string;
    repo?: InMemoryTurnRepo;
    idStart?: number;
} = {}) {
    const repo = opts.repo ?? new InMemoryTurnRepo();
    const models = new FakeModelRegistry(opts.models ?? []);
    const checker = opts.checker ?? new FakePermissionChecker();
    const classifier = opts.classifier ?? new FakePermissionClassifier();
    const bus = new FakeBus();
    const turnEventBus = new FakeTurnEventBus();
    const usage = new FakeUsageReporter();
    const runtime = new TurnRuntime({
        turnRepo: repo,
        idGenerator: new FakeIdGen(opts.idStart ?? 0),
        clock: new FakeClock(),
        agentResolver: new FakeAgentResolver(opts.agent ?? defaultAgent, opts.agentError),
        modelRegistry: models,
        toolRegistry: new FakeToolRegistry(opts.tools ?? defaultTools),
        contextResolver: new TurnRepoContextResolver({ turnRepo: repo }),
        permissionChecker: checker,
        permissionClassifier: classifier,
        lifecycleBus: bus,
        turnEventBus,
        usageReporter: usage,
    });
    return { runtime, repo, models, checker, classifier, bus, turnEventBus, usage };
}

async function newTurn(
    runtime: TurnRuntime,
    overrides: Partial<Parameters<TurnRuntime["createTurn"]>[0]> = {},
): Promise<string> {
    return runtime.createTurn({
        agent: { agentId: "copilot" },
        context: [],
        input: user("hello"),
        config: { humanAvailable: true },
        ...overrides,
    });
}

async function settle(execution: TurnExecution): Promise<{
    outcome?: TurnOutcome;
    error?: unknown;
    events: TurnStreamEvent[];
}> {
    const events: TurnStreamEvent[] = [];
    const consumer = (async () => {
        try {
            for await (const event of execution.events) {
                events.push(event);
            }
        } catch {
            // Infrastructure failures also reject the outcome; tests assert there.
        }
    })();
    let outcome: TurnOutcome | undefined;
    let error: unknown;
    try {
        outcome = await execution.outcome;
    } catch (err) {
        error = err;
    }
    await consumer;
    return { outcome, error, events };
}

async function advanceAndSettle(
    runtime: TurnRuntime,
    turnId: string,
    input?: Parameters<TurnRuntime["advanceTurn"]>[1],
    options?: Parameters<TurnRuntime["advanceTurn"]>[2],
) {
    return settle(runtime.advanceTurn(turnId, input, options));
}

class FakeUsageReporter {
    reports: Array<{
        agentId: string;
        model: { provider: string; model: string };
        usage: Record<string, number | undefined>;
    }> = [];
    reportModelUsage(report: {
        agentId: string;
        model: { provider: string; model: string };
        usage: Record<string, number | undefined>;
    }): void {
        this.reports.push(report);
    }
}

function typesOf(events: Array<{ type: string }>): string[] {
    return events.map((e) => e.type);
}

// The fake model's identity encoding passes structural messages through.
function sentMessages(request: ModelStreamRequest) {
    return request.messages as Array<{
        role: string;
        content?: unknown;
        toolCallId?: string;
    }>;
}

async function persisted(
    repo: InMemoryTurnRepo,
    turnId: string,
): Promise<Array<z.infer<typeof TurnEvent>>> {
    return repo.read(turnId);
}

// ---------------------------------------------------------------------------
// §26.1 Plain model response
// ---------------------------------------------------------------------------

describe("plain model response (26.1)", () => {
    it("runs one model step to completion with exact persisted request", async () => {
        const { runtime, repo, models, bus, usage } = makeRuntime({
            models: [
                respond(
                    { type: "text_delta", delta: "do" },
                    { type: "step_event", event: { type: "text_end", text: "done" } },
                    { type: "text_delta", delta: "ne" },
                    completedResp(assistantText("done")),
                ),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome, events } = await advanceAndSettle(runtime, turnId);

        expect(outcome).toMatchObject({
            status: "completed",
            output: assistantText("done"),
            finishReason: "stop",
        });

        const log = await persisted(repo, turnId);
        expect(typesOf(log)).toEqual([
            "turn_created",
            "model_call_requested",
            "model_step_event",
            "model_call_completed",
            "turn_completed",
        ]);
        const request = log[1];
        expect(request).toMatchObject({
            modelCallIndex: 0,
            request: { messages: ["input"] },
        });
        // The model received the composed payload: resolved system prompt,
        // snapshot tools, encoded messages.
        expect(models.requests[0].systemPrompt).toBe("SYS");
        expect(sentMessages(models.requests[0])).toEqual([user("hello")]);
        // One usage report per completed model call, after the durable append.
        expect(usage.reports).toEqual([
            {
                agentId: "copilot",
                model: defaultAgent.model,
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            },
        ]);
        // Deltas are streamed but never persisted.
        expect(events.filter((e) => e.type === "text_delta")).toHaveLength(2);
        expect(typesOf(log)).not.toContain("text_delta");
        // Terminal event duplicates output and aggregate usage.
        const terminal = log[log.length - 1];
        expect(terminal).toMatchObject({
            type: "turn_completed",
            output: assistantText("done"),
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        });
        // Lifecycle bus events are emitted but not persisted.
        expect(bus.events.map((e) => e.type)).toEqual([
            "turn-processing-start",
            "turn-processing-end",
        ]);
    });

    it("streams durable events only after persistence, matching the file", async () => {
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(assistantText("done")))],
        });
        const turnId = await newTurn(runtime);
        const { events } = await advanceAndSettle(runtime, turnId);
        const durable = events.filter(
            (e) => e.type !== "text_delta" && e.type !== "reasoning_delta",
        );
        const log = await persisted(repo, turnId);
        expect(durable).toEqual(log.slice(1));
    });

    it("outcome resolves without consuming the event stream", async () => {
        const { runtime } = makeRuntime({
            models: [respond(completedResp(assistantText("done")))],
        });
        const turnId = await newTurn(runtime);
        const execution = runtime.advanceTurn(turnId);
        const outcome = await execution.outcome;
        expect(outcome.status).toBe("completed");
    });
});

// ---------------------------------------------------------------------------
// §26.2 Mixed sync and async tools
// ---------------------------------------------------------------------------

describe("mixed sync and async tools (26.2)", () => {
    it("executes sync tools, suspends on async, and preserves source order in the next request", async () => {
        const batch = assistantCalls(
            toolCallPart("A", "echo", { i: 1 }),
            toolCallPart("B", "fetch", { i: 2 }),
            toolCallPart("C", "echo", { i: 3 }),
            toolCallPart("D", "fetch", { i: 4 }),
        );
        const { runtime, repo, models } = makeRuntime({
            models: [
                respond(completedResp(batch)),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);

        const first = await advanceAndSettle(runtime, turnId);
        expect(first.outcome).toMatchObject({
            status: "suspended",
            pendingAsyncTools: [
                expect.objectContaining({ toolCallId: "B" }),
                expect.objectContaining({ toolCallId: "D" }),
            ],
        });

        // Async results arrive in reverse order.
        const second = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "D",
            result: { output: "d-result", isError: false },
        });
        expect(second.outcome?.status).toBe("suspended");

        const third = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "B",
            result: { output: "b-result", isError: false },
        });
        expect(third.outcome?.status).toBe("completed");

        // The next model request carries results in original source order
        // even though physical completion order was A, C, D, B.
        const log = await persisted(repo, turnId);
        const secondRequest = log.find(
            (e) => e.type === "model_call_requested" && e.modelCallIndex === 1,
        );
        expect(secondRequest).toBeDefined();
        expect(
            secondRequest?.type === "model_call_requested"
                ? secondRequest.request.messages
                : [],
        ).toEqual([
            "assistant:0",
            "toolResult:A",
            "toolResult:B",
            "toolResult:C",
            "toolResult:D",
        ]);
        // The live model call saw the results in source order.
        expect(
            sentMessages(models.requests[1])
                .filter((m) => m.role === "tool")
                .map((m) => m.toolCallId),
        ).toEqual(["A", "B", "C", "D"]);
        // Byte-for-byte property: the durable file plus the shared composer
        // reproduces exactly what the model received.
        const state = reduceTurn(log);
        for (const index of [0, 1]) {
            const composed = composeModelRequest(state, index, [], defaultAgent, (m) => m as never);
            expect(composed.messages).toEqual(models.requests[index].messages);
            expect(composed.systemPrompt).toBe(models.requests[index].systemPrompt);
            expect(composed.tools).toEqual(models.requests[index].tools);
        }
        // Size guard: request events stay reference-sized — the transcript
        // duplication this design removes must not creep back.
        for (const event of log) {
            if (event.type === "model_call_requested") {
                expect(JSON.stringify(event).length).toBeLessThan(2048);
            }
        }
    });

    it("rejects async results for calls that are not pending", async () => {
        const { runtime } = makeRuntime({
            models: [respond(completedResp(assistantText("done")))],
        });
        const turnId = await newTurn(runtime);
        await advanceAndSettle(runtime, turnId);
        const { error } = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "ghost",
            result: { output: "x", isError: false },
        });
        expect(error).toBeInstanceOf(TurnInputError);
    });
});

// ---------------------------------------------------------------------------
// §26.3 Partial human permission decisions
// ---------------------------------------------------------------------------

describe("partial human permission decisions (26.3)", () => {
    async function setup() {
        const batch = assistantCalls(
            toolCallPart("P1", "echo"),
            toolCallPart("P2", "echo"),
            toolCallPart("F1", "fetch"),
        );
        const fixture = makeRuntime({
            models: [
                respond(completedResp(batch)),
                respond(completedResp(assistantText("done"))),
            ],
            checker: new FakePermissionChecker({
                echo: { request: { kind: "command" } },
            }),
        });
        const turnId = await newTurn(fixture.runtime);
        const first = await advanceAndSettle(fixture.runtime, turnId);
        return { ...fixture, turnId, first };
    }

    it("records all required permissions and exposes allowed async tools in one suspension", async () => {
        const { first } = await setup();
        expect(first.outcome).toMatchObject({
            status: "suspended",
            pendingPermissions: [
                expect.objectContaining({ toolCallId: "P1" }),
                expect.objectContaining({ toolCallId: "P2" }),
            ],
            pendingAsyncTools: [expect.objectContaining({ toolCallId: "F1" })],
        });
    });

    it("one approval advances only its tool; denial yields an error result; no model call until all settle", async () => {
        const { runtime, repo, turnId } = await setup();

        const afterAllow = await advanceAndSettle(runtime, turnId, {
            type: "permission_decision",
            toolCallId: "P1",
            decision: "allow",
        });
        expect(afterAllow.outcome).toMatchObject({
            status: "suspended",
            pendingPermissions: [expect.objectContaining({ toolCallId: "P2" })],
        });
        let log = await persisted(repo, turnId);
        expect(
            log.some(
                (e) => e.type === "tool_result" && e.toolCallId === "P1" && e.source === "sync",
            ),
        ).toBe(true);

        // Async result may arrive while a permission is still unresolved.
        const afterAsync = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "F1",
            result: { output: "fetched", isError: false },
        });
        expect(afterAsync.outcome?.status).toBe("suspended");

        const afterDeny = await advanceAndSettle(runtime, turnId, {
            type: "permission_decision",
            toolCallId: "P2",
            decision: "deny",
        });
        expect(afterDeny.outcome?.status).toBe("completed");

        log = await persisted(repo, turnId);
        const denial = log.find(
            (e) => e.type === "tool_result" && e.toolCallId === "P2",
        );
        expect(denial).toMatchObject({
            source: "runtime",
            result: { isError: true },
        });
        // Exactly two model calls: the batch, then the follow-up.
        expect(log.filter((e) => e.type === "model_call_requested")).toHaveLength(2);
    });

    it("rejects decisions for permissions that are not pending", async () => {
        const { runtime, turnId } = await setup();
        await advanceAndSettle(runtime, turnId, {
            type: "permission_decision",
            toolCallId: "P1",
            decision: "allow",
        });
        const { error } = await advanceAndSettle(runtime, turnId, {
            type: "permission_decision",
            toolCallId: "P1",
            decision: "deny",
        });
        expect(error).toBeInstanceOf(TurnInputError);
    });
});

// ---------------------------------------------------------------------------
// §26.4 Automatic permission classification
// ---------------------------------------------------------------------------

describe("automatic permission classification (26.4)", () => {
    const batch = assistantCalls(
        toolCallPart("CA", "echo"),
        toolCallPart("CD", "echo"),
        toolCallPart("CF", "echo"),
    );
    const checkerRules = { echo: { request: { kind: "command" as const } } };
    const classifierImpl = (requests: PermissionClassificationInput[]) =>
        requests.map((r): PermissionClassification => {
            const decision =
                r.toolCallId === "CA" ? "allow" : r.toolCallId === "CD" ? "deny" : "defer";
            return { toolCallId: r.toolCallId, decision, reason: `because ${decision}` };
        });

    it("handles allow, deny, and defer in one batch with a human available", async () => {
        const { runtime, repo, classifier } = makeRuntime({
            models: [respond(completedResp(batch))],
            checker: new FakePermissionChecker(checkerRules),
            classifier: new FakePermissionClassifier(classifierImpl),
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, autoPermission: true },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);

        // Deferred call asks the human.
        expect(outcome).toMatchObject({
            status: "suspended",
            pendingPermissions: [expect.objectContaining({ toolCallId: "CF" })],
        });
        expect(classifier.batches).toHaveLength(1);
        expect(classifier.batches[0].map((r) => r.toolCallId)).toEqual([
            "CA",
            "CD",
            "CF",
        ]);
        // Conversation context reaches the classifier: input + batch response.
        expect(classifier.contexts[0]).toEqual({
            turnId,
            messageCount: 2,
        });

        const log = await persisted(repo, turnId);
        // Classifier provenance and effective decisions are distinct records.
        expect(
            log.filter((e) => e.type === "tool_permission_classified"),
        ).toHaveLength(3);
        const resolved = log.filter((e) => e.type === "tool_permission_resolved");
        expect(resolved).toEqual([
            expect.objectContaining({ toolCallId: "CA", decision: "allow", source: "classifier" }),
            expect.objectContaining({ toolCallId: "CD", decision: "deny", source: "classifier" }),
        ]);
        // Allow executed; deny got an error result without invocation.
        expect(
            log.some((e) => e.type === "tool_result" && e.toolCallId === "CA" && e.source === "sync"),
        ).toBe(true);
        expect(
            log.some(
                (e) => e.type === "tool_invocation_requested" && e.toolCallId === "CD",
            ),
        ).toBe(false);
    });

    it("denies deferred calls when no human is available", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(batch)),
                respond(completedResp(assistantText("done"))),
            ],
            checker: new FakePermissionChecker(checkerRules),
            classifier: new FakePermissionClassifier(classifierImpl),
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: false, autoPermission: true },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        expect(
            log.find(
                (e) => e.type === "tool_permission_resolved" && e.toolCallId === "CF",
            ),
        ).toMatchObject({ decision: "deny", source: "human_unavailable" });
    });

    it("classifier failure records the failure and defers to the human", async () => {
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(batch))],
            checker: new FakePermissionChecker(checkerRules),
            classifier: new FakePermissionClassifier(undefined, "classifier exploded"),
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, autoPermission: true },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome).toMatchObject({ status: "suspended" });
        expect(
            outcome?.status === "suspended"
                ? outcome.pendingPermissions.map((p) => p.toolCallId)
                : [],
        ).toEqual(["CA", "CD", "CF"]);
        const log = await persisted(repo, turnId);
        expect(
            log.find((e) => e.type === "tool_permission_classification_failed"),
        ).toMatchObject({ toolCallIds: ["CA", "CD", "CF"] });
        // A later advance does not re-classify failed calls.
        const again = await advanceAndSettle(runtime, turnId);
        expect(again.outcome?.status).toBe("suspended");
    });

    it("missing decisions are recorded as per-call classification failures", async () => {
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(batch))],
            checker: new FakePermissionChecker(checkerRules),
            classifier: new FakePermissionClassifier((requests) =>
                requests
                    .filter((r) => r.toolCallId !== "CF")
                    .map((r) => ({
                        toolCallId: r.toolCallId,
                        decision: "allow",
                        reason: "ok",
                    })),
            ),
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, autoPermission: true },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome).toMatchObject({
            status: "suspended",
            pendingPermissions: [expect.objectContaining({ toolCallId: "CF" })],
        });
        const log = await persisted(repo, turnId);
        expect(
            log.find((e) => e.type === "tool_permission_classification_failed"),
        ).toMatchObject({ toolCallIds: ["CF"] });
    });

    it("manual mode never calls the classifier", async () => {
        const classifier = new FakePermissionClassifier(); // throws if called
        const { runtime } = makeRuntime({
            models: [respond(completedResp(batch))],
            checker: new FakePermissionChecker(checkerRules),
            classifier,
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, autoPermission: false },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("suspended");
        expect(classifier.batches).toHaveLength(0);
    });

    it("checker failure fails closed: recorded, routed to human, never auto-executed", async () => {
        const { runtime, repo, classifier } = makeRuntime({
            models: [respond(completedResp(assistantCalls(toolCallPart("X", "echo"))))],
            checker: new FakePermissionChecker({ echo: "throw" }),
            classifier: new FakePermissionClassifier(() => [
                { toolCallId: "X", decision: "allow", reason: "should not matter" },
            ]),
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, autoPermission: true },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome).toMatchObject({
            status: "suspended",
            pendingPermissions: [expect.objectContaining({ toolCallId: "X" })],
        });
        // The classifier is bypassed for checker-error calls.
        expect(classifier.batches).toHaveLength(0);
        const log = await persisted(repo, turnId);
        expect(
            log.find((e) => e.type === "tool_permission_required"),
        ).toMatchObject({ checkerError: "checker exploded" });
        expect(log.some((e) => e.type === "tool_invocation_requested")).toBe(false);
    });

    it("checker failure with no human denies without executing", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("X", "echo")))),
                respond(completedResp(assistantText("done"))),
            ],
            checker: new FakePermissionChecker({ echo: "throw" }),
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: false, autoPermission: false },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        expect(
            log.find((e) => e.type === "tool_permission_resolved"),
        ).toMatchObject({ decision: "deny", source: "human_unavailable" });
        expect(log.some((e) => e.type === "tool_invocation_requested")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Human-dependent tools
// ---------------------------------------------------------------------------

describe("human-dependent tools", () => {
    it("ask-human suspends as a pending async tool when a human is available", async () => {
        const { runtime } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("H", "ask-human")))),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);
        const first = await advanceAndSettle(runtime, turnId);
        expect(first.outcome).toMatchObject({
            status: "suspended",
            pendingAsyncTools: [expect.objectContaining({ toolCallId: "H" })],
        });
        const second = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "H",
            result: { output: "42", isError: false },
        });
        expect(second.outcome?.status).toBe("completed");
    });

    it("requiresHuman tools get an immediate error result when no human is available", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("H", "ask-human")))),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: false },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        expect(
            log.some((e) => e.type === "tool_invocation_requested" && e.toolCallId === "H"),
        ).toBe(true);
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "H")).toMatchObject({
            source: "runtime",
            result: { isError: true },
        });
    });
});

// ---------------------------------------------------------------------------
// §26.5 Cancellation
// ---------------------------------------------------------------------------

describe("cancellation (26.5)", () => {
    it("cancels a suspended turn via the cancel input", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("B", "fetch")))),
            ],
        });
        const turnId = await newTurn(runtime);
        await advanceAndSettle(runtime, turnId);

        const { outcome } = await advanceAndSettle(runtime, turnId, {
            type: "cancel",
            reason: "user stop",
        });
        expect(outcome).toMatchObject({ status: "cancelled", reason: "user stop" });

        const log = await persisted(repo, turnId);
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "B")).toMatchObject({
            source: "runtime",
            result: { isError: true },
        });
        expect(log[log.length - 1]).toMatchObject({
            type: "turn_cancelled",
            reason: "user stop",
        });

        // Late external inputs are rejected.
        const late = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "B",
            result: { output: "late", isError: false },
        });
        expect(late.error).toBeInstanceOf(TurnInputError);
    });

    it("cancels during a model call via the abort signal", async () => {
        const controller = new AbortController();
        let abortNow: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            abortNow = () => resolve();
        });
        const { runtime, repo } = makeRuntime({
            models: [hangUntilAbort(() => abortNow?.())],
        });
        const turnId = await newTurn(runtime);
        const execution = runtime.advanceTurn(turnId, undefined, {
            signal: controller.signal,
        });
        await started;
        controller.abort();
        const { outcome } = await settle(execution);
        expect(outcome?.status).toBe("cancelled");
        const log = await persisted(repo, turnId);
        expect(typesOf(log)).toEqual([
            "turn_created",
            "model_call_requested",
            "model_call_failed",
            "turn_cancelled",
        ]);
    });

    it("cancels during a sync tool with a synthetic result", async () => {
        const controller = new AbortController();
        const tools: RuntimeTool[] = [
            syncTool(echoDescriptor, async (_input, ctx: ToolExecutionContext) => {
                controller.abort();
                if (!ctx.signal.aborted) {
                    await new Promise<void>((resolve) => {
                        ctx.signal.addEventListener("abort", () => resolve(), {
                            once: true,
                        });
                    });
                }
                throw new Error("aborted mid-tool");
            }),
            { descriptor: fetchDescriptor as { execution: "async" } & typeof fetchDescriptor },
            { descriptor: askHumanDescriptor as { execution: "async" } & typeof askHumanDescriptor },
        ];
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(assistantCalls(toolCallPart("S", "echo"))))],
            tools,
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId, undefined, {
            signal: controller.signal,
        });
        expect(outcome?.status).toBe("cancelled");
        const log = await persisted(repo, turnId);
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "S")).toMatchObject({
            source: "runtime",
            result: { isError: true },
        });
        expect(log[log.length - 1].type).toBe("turn_cancelled");
    });
});

// ---------------------------------------------------------------------------
// §26.6 Failures
// ---------------------------------------------------------------------------

describe("failures (26.6)", () => {
    it("provider failure appends model and turn failures", async () => {
        const { runtime, repo } = makeRuntime({ models: [failCall("boom")] });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome).toMatchObject({ status: "failed", error: "boom" });
        const log = await persisted(repo, turnId);
        expect(typesOf(log)).toEqual([
            "turn_created",
            "model_call_requested",
            "model_call_failed",
            "turn_failed",
        ]);
    });

    it("a sync tool throw becomes an error result and the turn continues", async () => {
        const tools: RuntimeTool[] = [
            syncTool(echoDescriptor, async () => {
                throw new Error("tool exploded");
            }),
            { descriptor: fetchDescriptor as { execution: "async" } & typeof fetchDescriptor },
            { descriptor: askHumanDescriptor as { execution: "async" } & typeof askHumanDescriptor },
        ];
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("T", "echo")))),
                respond(completedResp(assistantText("recovered"))),
            ],
            tools,
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome).toMatchObject({
            status: "completed",
            output: assistantText("recovered"),
        });
        const log = await persisted(repo, turnId);
        expect(log.find((e) => e.type === "tool_result")).toMatchObject({
            source: "sync",
            result: { output: "tool exploded", isError: true },
        });
    });

    it("an async failure result becomes an error tool result and the turn continues", async () => {
        const { runtime } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("B", "fetch")))),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);
        await advanceAndSettle(runtime, turnId);
        const { outcome } = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "B",
            result: { output: "network unreachable", isError: true },
        });
        expect(outcome?.status).toBe("completed");
    });

    it("unknown tools become runtime error results, not turn failures", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("U", "no-such-tool")))),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "U")).toMatchObject({
            source: "runtime",
            result: { isError: true },
        });
    });

    it("repository errors reject stream and outcome without a false turn_failed", async () => {
        const { runtime } = makeRuntime();
        const execution = runtime.advanceTurn("2026-07-02T10-00-00Z-9999999-000");
        await expect(execution.outcome).rejects.toThrowError(/turn not found/);
        await expect(
            (async () => {
                for await (const event of execution.events) {
                    void event; // drain
                }
            })(),
        ).rejects.toThrowError(/turn not found/);
    });

    it("missing live tools reject the execution and leave the turn unchanged", async () => {
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(assistantText("done")))],
            tools: [], // registry knows nothing
        });
        const turnId = await newTurn(runtime);
        const { error } = await advanceAndSettle(runtime, turnId);
        expect(error).toBeInstanceOf(TurnDependencyError);
        expect((await persisted(repo, turnId)).length).toBe(1); // only turn_created
    });

    it("agent resolution failure rejects createTurn without creating a file", async () => {
        const { runtime, repo } = makeRuntime({ agentError: "no such agent" });
        await expect(newTurn(runtime)).rejects.toThrowError("no such agent");
        await expect(
            repo.read("2026-07-02T10-00-00Z-0000001-000"),
        ).rejects.toThrowError(/turn not found/);
    });
});

// ---------------------------------------------------------------------------
// §26.7 Crash recovery
// ---------------------------------------------------------------------------

describe("crash recovery (26.7)", () => {
    const SEED_ID = "2026-07-02T10-00-00Z-0000001-000";

    function seedCreated(config?: {
        autoPermission: boolean;
        humanAvailable: boolean;
        maxModelCalls: number;
    }): z.infer<typeof TurnEvent> {
        return {
            type: "turn_created",
            schemaVersion: 1,
            turnId: SEED_ID,
            ts: TS,
            sessionId: null,
            agent: { requested: { agentId: "copilot" }, resolved: defaultAgent },
            context: [],
            input: user("hello"),
            config: config ?? {
                autoPermission: false,
                humanAvailable: true,
                maxModelCalls: 20,
            },
        };
    }

    function seedRequested(
        index: number,
        refs: string[] = ["input"],
    ): z.infer<typeof TurnEvent> {
        return {
            type: "model_call_requested",
            turnId: SEED_ID,
            ts: TS,
            modelCallIndex: index,
            request: {
                messages: refs,
                parameters: {},
            },
        };
    }

    function seedCompleted(index: number, message: Parameters<typeof completedResp>[0]): z.infer<typeof TurnEvent> {
        return {
            type: "model_call_completed",
            turnId: SEED_ID,
            ts: TS,
            modelCallIndex: index,
            message,
            finishReason: "stop",
            usage: {},
        };
    }

    it("created-only log initiates the first model call", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed([seedCreated()]);
        const { runtime } = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("done")))],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
    });

    it("an unmatched model request is closed as interrupted and re-issued", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed([seedCreated(), seedRequested(0)]);
        const { runtime, models } = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("done")))],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, SEED_ID);
        expect(typesOf(log)).toEqual([
            "turn_created",
            "model_call_requested",
            "model_call_failed",
            "model_call_requested",
            "model_call_completed",
            "turn_completed",
        ]);
        expect(log[2]).toMatchObject({ error: expect.stringMatching(/interrupted/) });
        expect(models.requests).toHaveLength(1); // only the re-issued call hit the provider
    });

    it("the re-issued call counts against the model-call budget", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed([
            seedCreated({
                autoPermission: false,
                humanAvailable: true,
                maxModelCalls: 1,
            }),
            seedRequested(0),
        ]);
        const { runtime } = makeRuntime({ repo });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome).toMatchObject({
            status: "failed",
            code: MODEL_CALL_LIMIT_ERROR_CODE,
        });
    });

    it("an unmatched sync invocation gets an indeterminate result and the turn continues", async () => {
        const repo = new InMemoryTurnRepo();
        const batch = assistantCalls(toolCallPart("S", "echo"));
        repo.seed([
            seedCreated(),
            seedRequested(0),
            seedCompleted(0, batch),
            {
                type: "tool_invocation_requested",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "S",
                toolId: "tool.echo",
                toolName: "echo",
                execution: "sync",
                input: {},
            },
        ]);
        const { runtime } = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("done")))],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, SEED_ID);
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "S")).toMatchObject({
            source: "runtime",
            result: {
                output: expect.stringMatching(/interrupted; its outcome is unknown/),
                isError: true,
            },
        });
        // No turn_failed anywhere: the turn completed.
        expect(typesOf(log)).not.toContain("turn_failed");
    });

    it("an unmatched async invocation remains suspended, appending the missing snapshot", async () => {
        const repo = new InMemoryTurnRepo();
        const batch = assistantCalls(toolCallPart("B", "fetch"));
        repo.seed([
            seedCreated(),
            seedRequested(0),
            seedCompleted(0, batch),
            {
                type: "tool_invocation_requested",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "B",
                toolId: "tool.fetch",
                toolName: "fetch",
                execution: "async",
                input: {},
            },
        ]);
        const { runtime } = makeRuntime({ repo });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome).toMatchObject({
            status: "suspended",
            pendingAsyncTools: [expect.objectContaining({ toolCallId: "B" })],
        });
        const log = await persisted(repo, SEED_ID);
        expect(log[log.length - 1].type).toBe("turn_suspended");
    });

    it("re-advancing an already-suspended turn appends no duplicate snapshot", async () => {
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(assistantCalls(toolCallPart("B", "fetch"))))],
        });
        const turnId = await newTurn(runtime);
        await advanceAndSettle(runtime, turnId);
        const before = (await persisted(repo, turnId)).length;
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("suspended");
        expect((await persisted(repo, turnId)).length).toBe(before);
    });

    it("a completed tool batch proceeds to the next model call", async () => {
        const repo = new InMemoryTurnRepo();
        const batch = assistantCalls(toolCallPart("S", "echo"));
        repo.seed([
            seedCreated(),
            seedRequested(0),
            seedCompleted(0, batch),
            {
                type: "tool_invocation_requested",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "S",
                toolId: "tool.echo",
                toolName: "echo",
                execution: "sync",
                input: {},
            },
            {
                type: "tool_result",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "S",
                toolName: "echo",
                source: "sync",
                result: { output: "ok", isError: false },
            },
        ]);
        const { runtime, models } = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("done")))],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
        expect(
            sentMessages(models.requests[0]).filter((m) => m.role === "tool"),
        ).toHaveLength(1);
    });

    it("a permission resolved allow before invocation safely invokes the tool", async () => {
        const repo = new InMemoryTurnRepo();
        const batch = assistantCalls(toolCallPart("P", "echo"));
        repo.seed([
            seedCreated(),
            seedRequested(0),
            seedCompleted(0, batch),
            {
                type: "tool_permission_required",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "P",
                toolName: "echo",
                request: {},
            },
            {
                type: "tool_permission_resolved",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "P",
                decision: "allow",
                source: "human",
            },
        ]);
        const { runtime, repo: r } = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("done")))],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(r, SEED_ID);
        expect(log.some((e) => e.type === "tool_invocation_requested" && e.toolCallId === "P")).toBe(true);
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "P")).toMatchObject({
            source: "sync",
            result: { isError: false },
        });
    });

    it("a terminal turn returns its outcome and performs no writes", async () => {
        const { runtime, repo } = makeRuntime({
            models: [respond(completedResp(assistantText("done")))],
        });
        const turnId = await newTurn(runtime);
        await advanceAndSettle(runtime, turnId);
        const before = (await persisted(repo, turnId)).length;

        const again = await advanceAndSettle(runtime, turnId);
        expect(again.outcome).toMatchObject({
            status: "completed",
            output: assistantText("done"),
        });
        expect((await persisted(repo, turnId)).length).toBe(before);

        const withInput = await advanceAndSettle(runtime, turnId, {
            type: "cancel",
        });
        expect(withInput.error).toBeInstanceOf(TurnInputError);
    });
});

// ---------------------------------------------------------------------------
// §26.8 Historical and live reconstruction
// ---------------------------------------------------------------------------

describe("agent snapshot inheritance", () => {
    it("inherits system prompt + tools from an identical context predecessor", async () => {
        const { runtime, repo, models } = makeRuntime({
            models: [
                respond(completedResp(assistantText("first"))),
                respond(completedResp(assistantText("second"))),
            ],
        });
        const first = await newTurn(runtime, { sessionId: "S" });
        await advanceAndSettle(runtime, first);

        const second = await runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: first },
            input: user("again"),
            config: { humanAvailable: true },
        });
        const created = (await persisted(repo, second))[0];
        expect(created.type === "turn_created" ? created.agent.resolved : null).toEqual({
            agentId: "copilot",
            model: defaultAgent.model,
            inheritedFrom: first,
        });

        // The inherited turn still sends the full materialized snapshot.
        const { outcome } = await advanceAndSettle(runtime, second);
        expect(outcome?.status).toBe("completed");
        expect(models.requests[1].systemPrompt).toBe("SYS");
        expect(models.requests[1].tools).toEqual(defaultAgent.tools);
    });

    it("a model switch still inherits the prompt and tools (model stays concrete)", async () => {
        const repo = new InMemoryTurnRepo();
        const a = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("first")))],
        });
        const first = await newTurn(a.runtime, { sessionId: "S" });
        await advanceAndSettle(a.runtime, first);

        const switched = {
            ...defaultAgent,
            model: { provider: "anthropic", model: "claude-x" },
        };
        const b = makeRuntime({
            repo,
            agent: switched,
            idStart: 200,
            models: [respond(completedResp(assistantText("second")))],
        });
        const second = await b.runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: first },
            input: user("again"),
            config: { humanAvailable: true },
        });
        const created = (await persisted(repo, second))[0];
        expect(created.type === "turn_created" ? created.agent.resolved : null).toEqual({
            agentId: "copilot",
            model: { provider: "anthropic", model: "claude-x" },
            inheritedFrom: first,
        });
        const { outcome } = await advanceAndSettle(b.runtime, second);
        expect(outcome?.status).toBe("completed");
        // The switched model was resolved; prompt/tools came through the chain.
        expect(b.models.resolved[0]).toEqual({ provider: "anthropic", model: "claude-x" });
        expect(b.models.requests[0].systemPrompt).toBe("SYS");
        expect(b.models.requests[0].tools).toEqual(defaultAgent.tools);
    });

    it("a tools difference forces a full snapshot", async () => {
        const repo = new InMemoryTurnRepo();
        const a = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("first")))],
        });
        const first = await newTurn(a.runtime, { sessionId: "S" });
        await advanceAndSettle(a.runtime, first);

        const fewerTools = { ...defaultAgent, tools: [echoDescriptor] };
        const b = makeRuntime({ repo, agent: fewerTools, idStart: 300 });
        const second = await b.runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: first },
            input: user("again"),
            config: { humanAvailable: true },
        });
        const created = (await persisted(repo, second))[0];
        expect(
            created.type === "turn_created" && "tools" in created.agent.resolved
                ? created.agent.resolved.tools
                : null,
        ).toEqual([echoDescriptor]);
    });

    it("inheritance chains across turns and materializes through multiple hops", async () => {
        const { runtime, repo, models } = makeRuntime({
            models: [
                respond(completedResp(assistantText("one"))),
                respond(completedResp(assistantText("two"))),
                respond(completedResp(assistantText("three"))),
            ],
        });
        const t1 = await newTurn(runtime, { sessionId: "S" });
        await advanceAndSettle(runtime, t1);
        const t2 = await runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: t1 },
            input: user("two"),
            config: { humanAvailable: true },
        });
        await advanceAndSettle(runtime, t2);
        const t3 = await runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: t2 },
            input: user("three"),
            config: { humanAvailable: true },
        });
        const created3 = (await persisted(repo, t3))[0];
        // t3 inherits from t2, which itself inherits from t1 (the concrete base).
        expect(
            created3.type === "turn_created" && "inheritedFrom" in created3.agent.resolved
                ? created3.agent.resolved.inheritedFrom
                : null,
        ).toBe(t2);
        const { outcome } = await advanceAndSettle(runtime, t3);
        expect(outcome?.status).toBe("completed");
        expect(models.requests[2].systemPrompt).toBe("SYS");
        expect(models.requests[2].tools).toEqual(defaultAgent.tools);
    });

    it("standalone (inline-context) turns always persist a full snapshot", async () => {
        const { runtime, repo } = makeRuntime();
        const turnId = await newTurn(runtime);
        const created = (await persisted(repo, turnId))[0];
        expect(
            created.type === "turn_created" && "systemPrompt" in created.agent.resolved,
        ).toBe(true);
    });

    it("falls back to a full snapshot when the predecessor is unreadable", async () => {
        const { runtime, repo } = makeRuntime();
        const turnId = await runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: "2026-07-02T09-00-00Z-0000404-000" },
            input: user("orphan ref"),
            config: { humanAvailable: true },
        });
        const created = (await persisted(repo, turnId))[0];
        expect(
            created.type === "turn_created" && "systemPrompt" in created.agent.resolved,
        ).toBe(true);
    });

    it("persists a full snapshot when the resolved agent differs", async () => {
        const repo = new InMemoryTurnRepo();
        const a = makeRuntime({
            repo,
            models: [respond(completedResp(assistantText("first")))],
        });
        const first = await newTurn(a.runtime, { sessionId: "S" });
        await advanceAndSettle(a.runtime, first);

        const changedAgent = { ...defaultAgent, systemPrompt: "SYS v2" };
        const b = makeRuntime({ repo, agent: changedAgent, idStart: 100 });
        const second = await b.runtime.createTurn({
            agent: { agentId: "copilot" },
            sessionId: "S",
            context: { previousTurnId: first },
            input: user("again"),
            config: { humanAvailable: true },
        });
        const created = (await persisted(repo, second))[0];
        expect(
            created.type === "turn_created" && "systemPrompt" in created.agent.resolved
                ? created.agent.resolved.systemPrompt
                : null,
        ).toBe("SYS v2");
    });
});

describe("historical and live reconstruction (26.8)", () => {
    it("getTurn is read-only and matches live durable events", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(
                    { type: "text_delta", delta: "d" },
                    completedResp(assistantText("done")),
                ),
            ],
        });
        const turnId = await newTurn(runtime);
        const { events } = await advanceAndSettle(runtime, turnId);

        const before = (await persisted(repo, turnId)).length;
        const turn = await runtime.getTurn(turnId);
        expect((await persisted(repo, turnId)).length).toBe(before);

        const durable = events.filter(
            (e) => e.type !== "text_delta" && e.type !== "reasoning_delta",
        );
        expect(turn.events.slice(1)).toEqual(durable);
        // Ephemeral deltas are absent after reload.
        expect(turn.events.some((e) => (e.type as string) === "text_delta")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// §26.9 Model-call limit
// ---------------------------------------------------------------------------

describe("model-call limit (26.9)", () => {
    it("a tool-free response on the final allowed call completes normally", async () => {
        const { runtime } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("S", "echo")))),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, maxModelCalls: 2 },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
    });

    it("tool calls on the final call are fully processed, then the turn fails with the limit code", async () => {
        const { runtime, repo, models } = makeRuntime({
            models: [respond(completedResp(assistantCalls(toolCallPart("S", "echo"))))],
        });
        const turnId = await newTurn(runtime, {
            config: { humanAvailable: true, maxModelCalls: 1 },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome).toMatchObject({
            status: "failed",
            code: MODEL_CALL_LIMIT_ERROR_CODE,
        });
        const log = await persisted(repo, turnId);
        // The batch was fully processed before failing…
        expect(log.find((e) => e.type === "tool_result" && e.toolCallId === "S")).toMatchObject({
            result: { isError: false },
        });
        // …and no further model call was made.
        expect(models.requests).toHaveLength(1);
        expect(log[log.length - 1]).toMatchObject({
            type: "turn_failed",
            code: MODEL_CALL_LIMIT_ERROR_CODE,
        });
    });
});

// ---------------------------------------------------------------------------
// Tool progress
// ---------------------------------------------------------------------------

describe("tool progress", () => {
    it("sync progress persists before the callback resolves; async progress arrives as input", async () => {
        const tools: RuntimeTool[] = [
            syncTool(echoDescriptor, async (_input, ctx) => {
                await ctx.reportProgress({ pct: 50 });
                return { output: "done", isError: false };
            }),
            { descriptor: fetchDescriptor as { execution: "async" } & typeof fetchDescriptor },
            { descriptor: askHumanDescriptor as { execution: "async" } & typeof askHumanDescriptor },
        ];
        const { runtime, repo } = makeRuntime({
            models: [
                respond(
                    completedResp(
                        assistantCalls(toolCallPart("S", "echo"), toolCallPart("B", "fetch")),
                    ),
                ),
                respond(completedResp(assistantText("done"))),
            ],
            tools,
        });
        const turnId = await newTurn(runtime);
        await advanceAndSettle(runtime, turnId);

        await advanceAndSettle(runtime, turnId, {
            type: "async_tool_progress",
            toolCallId: "B",
            progress: { pct: 10 },
        });
        const { outcome } = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "B",
            result: { output: "fetched", isError: false },
        });
        expect(outcome?.status).toBe("completed");

        const log = await persisted(repo, turnId);
        const progress = log.filter((e) => e.type === "tool_progress");
        expect(progress).toEqual([
            expect.objectContaining({ toolCallId: "S", source: "sync" }),
            expect.objectContaining({ toolCallId: "B", source: "async" }),
        ]);
    });
});

describe("concurrent sync tool execution (10.5)", () => {
    const slowDescriptor: z.infer<typeof ToolDescriptor> = {
        toolId: "tool.slow",
        name: "slow",
        description: "Slow tool",
        inputSchema: {},
        execution: "sync",
        requiresHuman: false,
    };
    const fastDescriptor: z.infer<typeof ToolDescriptor> = {
        toolId: "tool.fast",
        name: "fast",
        description: "Fast tool",
        inputSchema: {},
        execution: "sync",
        requiresHuman: false,
    };
    const agent: z.infer<typeof ResolvedAgent> = {
        ...defaultAgent,
        tools: [slowDescriptor, fastDescriptor],
    };

    it("executes a batch concurrently: invocations in source order, results in completion order", async () => {
        // slow (first in source order) only finishes after fast has fully
        // completed AND reported progress. Under the old sequential loop this
        // deadlocks (fast never starts), so settling at all proves overlap.
        const order: string[] = [];
        let releaseSlow!: () => void;
        const slowGate = new Promise<void>((resolve) => {
            releaseSlow = resolve;
        });
        const tools: RuntimeTool[] = [
            syncTool(slowDescriptor, async () => {
                order.push("slow:start");
                await slowGate;
                order.push("slow:end");
                return { output: "slow-done", isError: false };
            }),
            syncTool(fastDescriptor, async (_input, ctx) => {
                order.push("fast:start");
                await ctx.reportProgress({ note: "while slow is pending" });
                order.push("fast:end");
                releaseSlow();
                return { output: "fast-done", isError: false };
            }),
        ];
        const { runtime, repo, models } = makeRuntime({
            agent,
            tools,
            models: [
                respond(
                    completedResp(
                        assistantCalls(
                            toolCallPart("S", "slow"),
                            toolCallPart("F", "fast"),
                        ),
                    ),
                ),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        expect(order).toEqual(["slow:start", "fast:start", "fast:end", "slow:end"]);

        // The log stays legal under interleaving: both invocations precede
        // any result (source order), fast's progress and result land while
        // slow is still open, and the reducer accepts the whole history.
        const log = await persisted(repo, turnId);
        expect(typesOf(log)).toEqual([
            "turn_created",
            "model_call_requested",
            "model_call_completed",
            "tool_invocation_requested",
            "tool_invocation_requested",
            "tool_progress",
            "tool_result",
            "tool_result",
            "model_call_requested",
            "model_call_completed",
            "turn_completed",
        ]);
        const invocations = log.filter(
            (e) => e.type === "tool_invocation_requested",
        );
        expect(invocations.map((e) => e.toolCallId)).toEqual(["S", "F"]);
        const results = log.filter((e) => e.type === "tool_result");
        expect(results.map((e) => e.toolCallId)).toEqual(["F", "S"]);
        const state = reduceTurn(log);
        expect(state.toolCalls.map((tc) => tc.result?.result.output)).toEqual([
            "slow-done",
            "fast-done",
        ]);

        // Wire ordering is insulated from completion order: the follow-up
        // request references tool results in the assistant message's source
        // order, and the composed payload sends them in that order.
        const followUp = log.find(
            (e) => e.type === "model_call_requested" && e.modelCallIndex === 1,
        );
        expect(followUp).toMatchObject({
            request: {
                messages: ["assistant:0", "toolResult:S", "toolResult:F"],
            },
        });
        const sent = sentMessages(models.requests[1]);
        expect(
            sent
                .filter((m) => m.role === "tool")
                .map((m) => (m as { toolCallId?: string }).toolCallId),
        ).toEqual(["S", "F"]);
    });

    it("one tool's failure never disturbs its concurrent siblings", async () => {
        let releaseSlow!: () => void;
        const slowGate = new Promise<void>((resolve) => {
            releaseSlow = resolve;
        });
        const tools: RuntimeTool[] = [
            syncTool(slowDescriptor, async () => {
                await slowGate;
                return { output: "slow-done", isError: false };
            }),
            syncTool(fastDescriptor, async () => {
                releaseSlow();
                throw new Error("fast exploded");
            }),
        ];
        const { runtime, repo } = makeRuntime({
            agent,
            tools,
            models: [
                respond(
                    completedResp(
                        assistantCalls(
                            toolCallPart("S", "slow"),
                            toolCallPart("F", "fast"),
                        ),
                    ),
                ),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        const byId = new Map(
            log
                .filter((e) => e.type === "tool_result")
                .map((e) => [e.toolCallId, e]),
        );
        expect(byId.get("F")).toMatchObject({
            result: { output: "fast exploded", isError: true },
        });
        expect(byId.get("S")).toMatchObject({
            result: { output: "slow-done", isError: false },
        });
    });

    it("cancellation mid-batch settles every in-flight tool", async () => {
        const controller = new AbortController();
        const started: string[] = [];
        function hangingTool(name: string) {
            return async (
                _input: unknown,
                ctx: ToolExecutionContext,
            ): Promise<{ output: string; isError: boolean }> => {
                started.push(name);
                if (started.length === 2) {
                    controller.abort();
                }
                await new Promise<void>((resolve) => {
                    if (ctx.signal.aborted) {
                        resolve();
                    } else {
                        ctx.signal.addEventListener("abort", () => resolve(), {
                            once: true,
                        });
                    }
                });
                throw new Error("aborted");
            };
        }
        const tools: RuntimeTool[] = [
            syncTool(slowDescriptor, hangingTool("slow")),
            syncTool(fastDescriptor, hangingTool("fast")),
        ];
        const { runtime, repo } = makeRuntime({
            agent,
            tools,
            models: [
                respond(
                    completedResp(
                        assistantCalls(
                            toolCallPart("S", "slow"),
                            toolCallPart("F", "fast"),
                        ),
                    ),
                ),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId, undefined, {
            signal: controller.signal,
        });
        expect(outcome?.status).toBe("cancelled");
        expect(started).toEqual(["slow", "fast"]);
        const log = await persisted(repo, turnId);
        const results = log.filter((e) => e.type === "tool_result");
        expect(results).toHaveLength(2);
        for (const result of results) {
            expect(result).toMatchObject({
                result: {
                    output: "Tool execution was cancelled.",
                    isError: true,
                },
            });
        }
        expect(typesOf(log)).toContain("turn_cancelled");
    });

    it("recovers a crash that left multiple sync invocations open", async () => {
        const SEED_ID = "2026-07-02T10-00-00Z-0000001-000";
        const repo = new InMemoryTurnRepo();
        const batch = assistantCalls(
            toolCallPart("S", "slow"),
            toolCallPart("F", "fast"),
        );
        repo.seed([
            {
                type: "turn_created",
                schemaVersion: 1,
                turnId: SEED_ID,
                ts: TS,
                sessionId: null,
                agent: { requested: { agentId: "copilot" }, resolved: agent },
                context: [],
                input: user("hello"),
                config: {
                    autoPermission: false,
                    humanAvailable: true,
                    maxModelCalls: 20,
                },
            },
            {
                type: "model_call_requested",
                turnId: SEED_ID,
                ts: TS,
                modelCallIndex: 0,
                request: { messages: ["input"], parameters: {} },
            },
            {
                type: "model_call_completed",
                turnId: SEED_ID,
                ts: TS,
                modelCallIndex: 0,
                message: batch,
                finishReason: "stop",
                usage: {},
            },
            {
                type: "tool_invocation_requested",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "S",
                toolId: "tool.slow",
                toolName: "slow",
                execution: "sync",
                input: {},
            },
            {
                type: "tool_invocation_requested",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "F",
                toolId: "tool.fast",
                toolName: "fast",
                execution: "sync",
                input: {},
            },
        ]);
        const { runtime } = makeRuntime({
            repo,
            agent,
            tools: [
                syncTool(slowDescriptor, async () => ({
                    output: "never",
                    isError: false,
                })),
                syncTool(fastDescriptor, async () => ({
                    output: "never",
                    isError: false,
                })),
            ],
            models: [respond(completedResp(assistantText("done")))],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, SEED_ID);
        const indeterminate = log.filter(
            (e) =>
                e.type === "tool_result" &&
                e.source === "runtime" &&
                e.result.isError === true,
        );
        expect(indeterminate.map((e) => (e as { toolCallId: string }).toolCallId).sort()).toEqual([
            "F",
            "S",
        ]);
    });
});

describe("mid-turn tool extension", () => {
    const writeDescriptor: z.infer<typeof ToolDescriptor> = {
        toolId: "tool.write",
        name: "write",
        description: "Write tool",
        inputSchema: {},
        execution: "sync",
        requiresHuman: false,
    };

    function additionsTool(
        descriptor: z.infer<typeof ToolDescriptor>,
        tools: Array<z.infer<typeof ToolDescriptor>>,
        source = "organize-files",
    ): SyncRuntimeTool {
        return syncTool(descriptor, async () => ({
            output: { success: true },
            isError: false,
            metadata: { toolAdditions: { source, tools } },
        }));
    }

    const writeImpl = syncTool(writeDescriptor, async () => ({
        output: "written",
        isError: false,
    }));

    it("appends tools_extended and the added tool is callable on the next step", async () => {
        const { runtime, repo, models } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("tc1", "echo")))),
                respond(completedResp(assistantCalls(toolCallPart("tc2", "write")))),
                respond(completedResp(assistantText("done"))),
            ],
            tools: [
                additionsTool(echoDescriptor, [writeDescriptor]),
                writeImpl,
                ...defaultTools.slice(1),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome, error } = await advanceAndSettle(runtime, turnId);
        expect(error).toBeUndefined();
        expect(outcome?.status).toBe("completed");

        const log = await persisted(repo, turnId);
        const extensions = log.filter((e) => e.type === "tools_extended");
        expect(extensions).toHaveLength(1);
        expect(extensions[0]).toMatchObject({
            toolCallId: "tc1",
            source: "organize-files",
            tools: [writeDescriptor],
        });

        // Call 0 was composed without the tool; call 1 carries it natively.
        expect(models.requests[0].tools.map((t) => t.name)).not.toContain("write");
        expect(models.requests[1].tools.map((t) => t.name)).toContain("write");

        // The reducer accepts the full history and the added tool executed.
        const state = reduceTurn(log);
        const tc2 = state.toolCalls.find((tc) => tc.toolCallId === "tc2");
        expect(tc2?.toolId).toBe("tool.write");
        expect(tc2?.result?.result.output).toBe("written");
    });

    it("additions already attached dedupe to no event", async () => {
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("tc1", "echo")))),
                respond(completedResp(assistantText("done"))),
            ],
            tools: [
                additionsTool(echoDescriptor, [echoDescriptor], "self"),
                ...defaultTools.slice(1),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        expect(log.filter((e) => e.type === "tools_extended")).toHaveLength(0);
    });

    it("additions without a live implementation are dropped, not fatal", async () => {
        const ghost: z.infer<typeof ToolDescriptor> = {
            ...writeDescriptor,
            toolId: "tool.ghost",
            name: "ghost",
        };
        const { runtime, repo } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("tc1", "echo")))),
                respond(completedResp(assistantText("done"))),
            ],
            tools: [
                additionsTool(echoDescriptor, [ghost]),
                ...defaultTools.slice(1),
            ],
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");
        const log = await persisted(repo, turnId);
        expect(log.filter((e) => e.type === "tools_extended")).toHaveLength(0);
    });

    it("concurrent overlapping additions dedupe atomically to one descriptor", async () => {
        const echo2Descriptor: z.infer<typeof ToolDescriptor> = {
            ...echoDescriptor,
            toolId: "tool.echo2",
            name: "echo2",
        };
        const { runtime, repo } = makeRuntime({
            models: [
                respond(
                    completedResp(
                        assistantCalls(
                            toolCallPart("tc1", "echo"),
                            toolCallPart("tc2", "echo2"),
                        ),
                    ),
                ),
                respond(completedResp(assistantText("done"))),
            ],
            tools: [
                additionsTool(echoDescriptor, [writeDescriptor], "skill-a"),
                additionsTool(echo2Descriptor, [writeDescriptor], "skill-b"),
                writeImpl,
                ...defaultTools.slice(1),
            ],
            agent: {
                ...defaultAgent,
                tools: [
                    echoDescriptor,
                    echo2Descriptor,
                    fetchDescriptor,
                    askHumanDescriptor,
                ],
            },
        });
        const turnId = await newTurn(runtime);
        const { outcome } = await advanceAndSettle(runtime, turnId);
        expect(outcome?.status).toBe("completed");

        const log = await persisted(repo, turnId);
        const added = log
            .filter((e) => e.type === "tools_extended")
            .flatMap((e) => (e.type === "tools_extended" ? e.tools : []));
        expect(added.filter((t) => t.name === "write")).toHaveLength(1);
        // reduceTurn would throw on a collision; acceptance is the assertion.
        expect(() => reduceTurn(log)).not.toThrow();
    });

    it("recovers from a log ending right after tools_extended", async () => {
        const SEED_ID = "2026-07-02T10-00-00Z-0000009-000";
        const repo = new InMemoryTurnRepo();
        repo.seed([
            {
                type: "turn_created",
                schemaVersion: 1,
                turnId: SEED_ID,
                ts: TS,
                sessionId: null,
                agent: { requested: { agentId: "copilot" }, resolved: defaultAgent },
                context: [],
                input: user("hello"),
                config: {
                    autoPermission: false,
                    humanAvailable: true,
                    maxModelCalls: 20,
                },
            },
            {
                type: "model_call_requested",
                turnId: SEED_ID,
                ts: TS,
                modelCallIndex: 0,
                request: { messages: ["input"], parameters: {} },
            },
            {
                type: "model_call_completed",
                turnId: SEED_ID,
                ts: TS,
                modelCallIndex: 0,
                message: assistantCalls(toolCallPart("tc1", "echo")),
                finishReason: "stop",
                usage: {},
            },
            {
                type: "tool_invocation_requested",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "tc1",
                toolId: echoDescriptor.toolId,
                toolName: "echo",
                execution: "sync",
                input: {},
            },
            {
                type: "tool_result",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "tc1",
                toolName: "echo",
                source: "sync",
                result: { output: { success: true }, isError: false },
            },
            {
                type: "tools_extended",
                turnId: SEED_ID,
                ts: TS,
                toolCallId: "tc1",
                source: "organize-files",
                tools: [writeDescriptor],
            },
        ]);
        const { runtime, models } = makeRuntime({
            repo,
            models: [
                respond(completedResp(assistantCalls(toolCallPart("tc2", "write")))),
                respond(completedResp(assistantText("done"))),
            ],
            tools: [
                additionsTool(echoDescriptor, [writeDescriptor]),
                writeImpl,
                ...defaultTools.slice(1),
            ],
        });
        const { outcome } = await advanceAndSettle(runtime, SEED_ID);
        expect(outcome?.status).toBe("completed");
        // The re-advance rebuilt the extended toolset from the durable log:
        // its first composed request already includes the added tool, and the
        // model's call to it executes.
        expect(models.requests[0].tools.map((t) => t.name)).toContain("write");
        const log = await persisted(repo, SEED_ID);
        const state = reduceTurn(log);
        expect(
            state.toolCalls.find((tc) => tc.toolCallId === "tc2")?.result?.result
                .output,
        ).toBe("written");
    });
});

// ---------------------------------------------------------------------------
// Turn event bus: process-wide tagged event spine
// ---------------------------------------------------------------------------

describe("turn event bus", () => {
    it("publishes every durable event with its file offset and deltas without", async () => {
        const { runtime, repo, turnEventBus } = makeRuntime({
            models: [
                respond(
                    { type: "text_delta", delta: "do" },
                    { type: "text_delta", delta: "ne" },
                    completedResp(assistantText("done")),
                ),
            ],
        });
        const turnId = await newTurn(runtime, { sessionId: "s1" });
        await advanceAndSettle(runtime, turnId);

        // Durable bus events mirror the persisted file exactly, in order,
        // with 1-based line offsets — turn_created included.
        const log = await persisted(repo, turnId);
        const durable = turnEventBus.events.filter((e) =>
            isDurableTurnEvent(e.event),
        );
        expect(durable.map((e) => e.event)).toEqual(log);
        expect(durable.map((e) => e.offset)).toEqual(log.map((_, i) => i + 1));

        // Every bus event is tagged with its origin.
        for (const event of turnEventBus.events) {
            expect(event.turnId).toBe(turnId);
            expect(event.sessionId).toBe("s1");
        }

        // Deltas ride the bus without offsets (they are not durable).
        const deltas = turnEventBus.events.filter(
            (e) => !isDurableTurnEvent(e.event),
        );
        expect(deltas.map((e) => e.event.type)).toEqual([
            "text_delta",
            "text_delta",
        ]);
        expect(deltas.every((e) => e.offset === undefined)).toBe(true);
    });

    it("continues offsets across suspend/resume invocations of one turn", async () => {
        const { runtime, repo, turnEventBus } = makeRuntime({
            models: [
                respond(completedResp(assistantCalls(toolCallPart("c1", "fetch")))),
                respond(completedResp(assistantText("done"))),
            ],
        });
        const turnId = await newTurn(runtime);
        const first = await advanceAndSettle(runtime, turnId);
        expect(first.outcome?.status).toBe("suspended");
        const second = await advanceAndSettle(runtime, turnId, {
            type: "async_tool_result",
            toolCallId: "c1",
            result: { output: "ok", isError: false },
        });
        expect(second.outcome?.status).toBe("completed");

        const log = await persisted(repo, turnId);
        const durable = turnEventBus.events.filter((e) =>
            isDurableTurnEvent(e.event),
        );
        expect(durable.map((e) => e.event)).toEqual(log);
        expect(durable.map((e) => e.offset)).toEqual(log.map((_, i) => i + 1));
        expect(durable.every((e) => e.sessionId === null)).toBe(true);
    });
});
