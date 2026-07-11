import { z } from "zod";
import {
    DEFAULT_MAX_MODEL_CALLS,
    MODEL_CALL_LIMIT_ERROR_CODE,
    type ConversationMessage,
    type JsonValue,
    type ModelCallFailed,
    type ModelRequest,
    type ResolvedAgent,
    type ResolvedAgentSnapshot,
    assistantRef,
    toolResultRef,
    type ToolCallState,
    ToolDescriptor,
    type ToolInvocationRequested,
    type ToolPermissionRequired,
    type ToolPermissionResolved,
    type ToolResult,
    ToolResultData,
    TurnCreated,
    type TurnEvent,
    type TurnState,
    type TurnStreamEvent,
    type TurnSuspended,
    effectiveTools,
    outstandingAsyncTools,
    outstandingPermissions,
    reduceTurn,
} from "@x/shared/dist/turns.js";
import type { IMonotonicallyIncreasingIdGenerator } from "../../application/lib/id-gen.js";
import type { IAgentResolver } from "./agent-resolver.js";
import {
    type CreateTurnInput,
    type ITurnRuntime,
    type Turn,
    TurnDependencyError,
    type TurnExecution,
    type TurnExternalInput,
    TurnInputError,
    type TurnOutcome,
} from "./api.js";
import type { ITurnLifecycleBus } from "./bus.js";
import type { IClock } from "./clock.js";
import type { ITurnEventBus } from "./event-hub.js";
import { composeModelRequest } from "./compose-model-request.js";
import type { IUsageReporter } from "./usage-reporter.js";
import type { IContextResolver } from "./context-resolver.js";
import type {
    IModelRegistry,
    LlmStreamEvent,
    ResolvedModel,
} from "./model-registry.js";
import type { IPermissionChecker, IPermissionClassifier } from "./permission.js";
import type { ITurnRepo } from "./repo.js";
import { HotStream } from "./stream.js";
import type { IToolRegistry, RuntimeTool, SyncRuntimeTool } from "./tool-registry.js";

type TEvent = z.infer<typeof TurnEvent>;

const INTERRUPTED_TOOL_MESSAGE =
    "Tool execution was interrupted; its outcome is unknown and it was not retried.";

export interface TurnRuntimeDependencies {
    turnRepo: ITurnRepo;
    idGenerator: IMonotonicallyIncreasingIdGenerator;
    clock: IClock;
    agentResolver: IAgentResolver;
    modelRegistry: IModelRegistry;
    toolRegistry: IToolRegistry;
    contextResolver: IContextResolver;
    permissionChecker: IPermissionChecker;
    permissionClassifier: IPermissionClassifier;
    lifecycleBus: ITurnLifecycleBus;
    turnEventBus: ITurnEventBus;
    usageReporter: IUsageReporter;
}

// Immutable dependency container: holds no mutable per-turn state. All active
// turn state is reconstructed from the repository inside each invocation.
export class TurnRuntime implements ITurnRuntime {
    private readonly turnRepo: ITurnRepo;
    private readonly idGenerator: IMonotonicallyIncreasingIdGenerator;
    private readonly clock: IClock;
    private readonly agentResolver: IAgentResolver;
    private readonly modelRegistry: IModelRegistry;
    private readonly toolRegistry: IToolRegistry;
    private readonly contextResolver: IContextResolver;
    private readonly permissionChecker: IPermissionChecker;
    private readonly permissionClassifier: IPermissionClassifier;
    private readonly lifecycleBus: ITurnLifecycleBus;
    private readonly turnEventBus: ITurnEventBus;
    private readonly usageReporter: IUsageReporter;

    constructor({
        turnRepo,
        idGenerator,
        clock,
        agentResolver,
        modelRegistry,
        toolRegistry,
        contextResolver,
        permissionChecker,
        permissionClassifier,
        lifecycleBus,
        turnEventBus,
        usageReporter,
    }: TurnRuntimeDependencies) {
        this.turnRepo = turnRepo;
        this.idGenerator = idGenerator;
        this.clock = clock;
        this.agentResolver = agentResolver;
        this.modelRegistry = modelRegistry;
        this.toolRegistry = toolRegistry;
        this.contextResolver = contextResolver;
        this.permissionChecker = permissionChecker;
        this.permissionClassifier = permissionClassifier;
        this.lifecycleBus = lifecycleBus;
        this.turnEventBus = turnEventBus;
        this.usageReporter = usageReporter;
    }

    async createTurn(input: CreateTurnInput): Promise<string> {
        const resolved = await this.agentResolver.resolve(input.agent);
        const turnId = await this.idGenerator.next();
        // Inherit the heavy snapshot fields (system prompt + tools) when they
        // are byte-identical to the context predecessor's materialized
        // snapshot — the same reference mechanism as context and requests.
        // The model stays concrete for the session index and so a model
        // switch never blocks inheritance.
        let snapshot: z.infer<typeof ResolvedAgentSnapshot> = resolved;
        if (!Array.isArray(input.context)) {
            try {
                const previousEvents = await this.turnRepo.read(
                    input.context.previousTurnId,
                );
                const previous = await this.contextResolver.resolveAgent(
                    reduceTurn(previousEvents).definition.agent.resolved,
                );
                if (
                    previous.systemPrompt === resolved.systemPrompt &&
                    JSON.stringify(previous.tools) === JSON.stringify(resolved.tools)
                ) {
                    snapshot = {
                        agentId: resolved.agentId,
                        model: resolved.model,
                        inheritedFrom: input.context.previousTurnId,
                    };
                }
            } catch {
                // Unreadable predecessor: persist the full snapshot; context
                // resolution surfaces the real problem at advance time.
            }
        }
        const event = TurnCreated.parse({
            type: "turn_created",
            schemaVersion: 1,
            turnId,
            ts: this.clock.now(),
            sessionId: input.sessionId ?? null,
            agent: { requested: input.agent, resolved: snapshot },
            context: input.context,
            input: input.input,
            config: {
                autoPermission: input.config.autoPermission ?? false,
                humanAvailable: input.config.humanAvailable,
                maxModelCalls: input.config.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
                ...(input.config.reasoningEffort === undefined
                    ? {}
                    : { reasoningEffort: input.config.reasoningEffort }),
            },
        });
        await this.turnRepo.create(event);
        // turn_created never flows through an advance's execution stream, so
        // publish it here; it is always line 1 of the turn file.
        this.turnEventBus.publish({
            turnId,
            sessionId: event.sessionId,
            event,
            offset: 1,
        });
        return turnId;
    }

    async getTurn(turnId: string): Promise<Turn> {
        const events = await this.turnRepo.read(turnId);
        return { turnId, events };
    }

    advanceTurn(
        turnId: string,
        input?: TurnExternalInput,
        options?: { signal?: AbortSignal },
    ): TurnExecution {
        const stream = new HotStream<TurnStreamEvent, TurnOutcome>();
        void this.turnRepo
            .withLock(turnId, () =>
                this.advanceLocked(turnId, input, options?.signal, stream),
            )
            .then(
                (outcome) => stream.end(outcome),
                (error: unknown) => stream.fail(error),
            );
        return { events: stream.events, outcome: stream.outcome };
    }

    private async advanceLocked(
        turnId: string,
        input: TurnExternalInput | undefined,
        externalSignal: AbortSignal | undefined,
        stream: HotStream<TurnStreamEvent, TurnOutcome>,
    ): Promise<TurnOutcome> {
        this.lifecycleBus.publish({ type: "turn-processing-start", turnId });
        try {
            return await this.advance(turnId, input, externalSignal, stream);
        } finally {
            this.lifecycleBus.publish({ type: "turn-processing-end", turnId });
        }
    }

    // §18 steps 4–7: read, reduce, short-circuit terminal turns, and prepare
    // live-dependency materialization. Materialization itself is deferred
    // into run(): non-cancel work awaits it first, so failures there remain
    // infrastructure errors that reject the execution with the turn
    // unchanged — but a cancel input never needs it (§22), so a turn whose
    // environment can no longer be resolved can always be cancelled.
    private async advance(
        turnId: string,
        input: TurnExternalInput | undefined,
        externalSignal: AbortSignal | undefined,
        stream: HotStream<TurnStreamEvent, TurnOutcome>,
    ): Promise<TurnOutcome> {
        const events = await this.turnRepo.read(turnId);
        const state = reduceTurn(events);

        if (state.terminal) {
            if (input) {
                throw new TurnInputError(`turn ${turnId} is terminal; input rejected`);
            }
            return outcomeFromTerminal(state);
        }

        const definition = state.definition;
        const materialize = async (): Promise<MaterializedEnv> => {
            const resolvedContext = await this.contextResolver.resolve(
                definition.context,
            );
            const resolvedAgent = await this.contextResolver.resolveAgent(
                definition.agent.resolved,
            );
            const model = await this.modelRegistry.resolve(resolvedAgent.model);
            // Base snapshot plus every durable mid-turn extension already in
            // the log — rebuilding from durable state IS the crash-recovery
            // path.
            const toolsByName = new Map<string, RuntimeTool>();
            for (const descriptor of effectiveTools(
                state,
                state.modelCalls.length,
                resolvedAgent.tools,
            )) {
                const tool = await this.toolRegistry.resolve(descriptor);
                if (
                    tool.descriptor.toolId !== descriptor.toolId ||
                    tool.descriptor.execution !== descriptor.execution
                ) {
                    throw new TurnDependencyError(
                        `resolved tool ${descriptor.toolId} does not match its persisted descriptor`,
                    );
                }
                toolsByName.set(descriptor.name, tool);
            }
            return { resolvedContext, resolvedAgent, model, toolsByName };
        };

        const controller = new AbortController();
        const forwardAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            } else {
                externalSignal.addEventListener("abort", forwardAbort, {
                    once: true,
                });
            }
        }

        const run = new TurnAdvance({
            turnId,
            events,
            state,
            stream,
            materialize,
            usageReporter: this.usageReporter,
            resolveTool: (descriptor) => this.toolRegistry.resolve(descriptor),
            signal: controller.signal,
            turnRepo: this.turnRepo,
            clock: this.clock,
            permissionChecker: this.permissionChecker,
            permissionClassifier: this.permissionClassifier,
            turnEventBus: this.turnEventBus,
        });
        try {
            return await run.run(input);
        } finally {
            if (externalSignal) {
                externalSignal.removeEventListener("abort", forwardAbort);
            }
        }
    }
}

// The live execution environment resolved from a turn's durable snapshot.
// Materialized lazily by run(): every phase that continues the turn needs
// it; cancellation deliberately does not (§22).
interface MaterializedEnv {
    resolvedContext: Array<z.infer<typeof ConversationMessage>>;
    resolvedAgent: z.infer<typeof ResolvedAgent>;
    model: ResolvedModel;
    toolsByName: Map<string, RuntimeTool>;
}

// One advanceTurn invocation. Owns the per-invocation context and implements
// the §18 main loop as one method per phase. All state it acts on is derived
// from the durable log via the shared reducer after every append.
class TurnAdvance {
    private readonly turnId: string;
    private readonly events: TEvent[];
    private state: TurnState;
    private readonly stream: HotStream<TurnStreamEvent, TurnOutcome>;
    private readonly materialize: () => Promise<MaterializedEnv>;
    // Assigned by run() immediately after the cancel fast-path, before any
    // loop phase can touch them. cancel() must never read these.
    private resolvedContext!: Array<z.infer<typeof ConversationMessage>>;
    private resolvedAgent!: z.infer<typeof ResolvedAgent>;
    private model!: ResolvedModel;
    private toolsByName!: Map<string, RuntimeTool>;
    private readonly usageReporter: IUsageReporter;
    private readonly resolveTool: (
        descriptor: z.infer<typeof ToolDescriptor>,
    ) => Promise<RuntimeTool>;
    private readonly signal: AbortSignal;
    private readonly turnRepo: ITurnRepo;
    private readonly clock: IClock;
    private readonly permissionChecker: IPermissionChecker;
    private readonly permissionClassifier: IPermissionClassifier;
    private readonly turnEventBus: ITurnEventBus;

    // Checker "allowed" outcomes are deliberately not durable: after a crash
    // the checker is simply re-consulted.
    private readonly checkerAllowed = new Set<string>();
    private appended = false;
    private cancelReason: string | undefined;

    constructor(init: {
        turnId: string;
        events: TEvent[];
        state: TurnState;
        stream: HotStream<TurnStreamEvent, TurnOutcome>;
        materialize: () => Promise<MaterializedEnv>;
        usageReporter: IUsageReporter;
        resolveTool: (
            descriptor: z.infer<typeof ToolDescriptor>,
        ) => Promise<RuntimeTool>;
        signal: AbortSignal;
        turnRepo: ITurnRepo;
        clock: IClock;
        permissionChecker: IPermissionChecker;
        permissionClassifier: IPermissionClassifier;
        turnEventBus: ITurnEventBus;
    }) {
        this.turnId = init.turnId;
        this.events = init.events;
        this.state = init.state;
        this.stream = init.stream;
        this.materialize = init.materialize;
        this.usageReporter = init.usageReporter;
        this.resolveTool = init.resolveTool;
        this.signal = init.signal;
        this.turnRepo = init.turnRepo;
        this.clock = init.clock;
        this.permissionChecker = init.permissionChecker;
        this.permissionClassifier = init.permissionClassifier;
        this.turnEventBus = init.turnEventBus;
    }

    private get definition(): TurnState["definition"] {
        return this.state.definition;
    }

    // Deltas ride the execution stream and the process-wide bus, never storage.
    private pushDelta(delta: Extract<TurnStreamEvent, { type: "text_delta" | "reasoning_delta" }>): void {
        this.stream.push(delta);
        this.turnEventBus.publish({
            turnId: this.turnId,
            sessionId: this.definition.sessionId,
            event: delta,
        });
    }

    private now(): string {
        return this.clock.now();
    }

    // Durable barrier: reduce (the reducer gates the append — see commit),
    // persist, then stream. Commits are serialized through an internal queue
    // so concurrently executing tools can never interleave the
    // reduce/persist/stream ritual — file order, in-memory order, and stream
    // order stay identical by construction.
    private appendChain: Promise<void> = Promise.resolve();

    private append(...batch: TEvent[]): Promise<void> {
        const task = this.appendChain.then(() => this.commit(batch));
        // A failed commit rejects for its caller only; the chain stays alive
        // so other in-flight tools can still record their results.
        this.appendChain = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }

    // Like append, but the batch is computed inside this task's serialized
    // commit slot, so the builder reads this.state with no interleaving
    // commits. Required for the tools_extended dedupe: two concurrent tool
    // results may each carry overlapping additions, and the second filter
    // must see the first's committed extension. Returning undefined commits
    // nothing.
    private appendWith(build: () => TEvent[] | undefined): Promise<void> {
        const task = this.appendChain.then(async () => {
            const batch = build();
            if (batch && batch.length > 0) {
                await this.commit(batch);
            }
        });
        this.appendChain = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }

    private async commit(batch: TEvent[]): Promise<void> {
        // Gate before the write: an illegal batch (e.g. a misbehaving tool
        // reporting progress after its result) must reject in memory, never
        // become durable — a persisted illegal event makes the file fail
        // every future read and, through context references, blocks the
        // whole session chain.
        const next = reduceTurn([...this.events, ...batch]);
        await this.turnRepo.append(this.turnId, batch);
        // this.events holds the full file history (read at advance start), so
        // its length is the absolute 1-based line offset of each new event.
        const base = this.events.length;
        this.events.push(...batch);
        this.state = next;
        this.appended = true;
        for (const [i, event] of batch.entries()) {
            this.stream.push(event);
            this.turnEventBus.publish({
                turnId: this.turnId,
                sessionId: this.definition.sessionId,
                event,
                offset: base + i + 1,
            });
        }
    }

    // §18 step 8: repeatedly advance deterministic work. Each phase either
    // appends durable facts and lets the loop continue, or produces the
    // invocation's outcome.
    async run(input: TurnExternalInput | undefined): Promise<TurnOutcome> {
        // §22: cancel is the one input that must keep working when the
        // environment is gone (provider unconfigured, builtin renamed,
        // context chain unreadable) — it needs no live dependencies, so it
        // runs before materialization.
        if (input?.type === "cancel") {
            this.cancelReason = input.reason;
            return this.cancel();
        }
        // §15.3: everything that continues the turn materializes first, so
        // a broken environment rejects as infrastructure before any input
        // is persisted and the turn is left unchanged.
        const env = await this.materialize();
        this.resolvedContext = env.resolvedContext;
        this.resolvedAgent = env.resolvedAgent;
        this.model = env.model;
        this.toolsByName = env.toolsByName;
        if (input) {
            await this.applyInput(input);
        }
        for (;;) {
            if (this.signal.aborted) {
                return this.cancel();
            }
            if (await this.closeInterruptedModelCall()) {
                continue;
            }
            if (await this.closeInterruptedSyncTools()) {
                continue;
            }
            await this.evaluatePermissions();
            if (this.signal.aborted) {
                return this.cancel();
            }
            await this.classifyBatch();
            if (this.signal.aborted) {
                return this.cancel();
            }
            await this.denyUnresolvedWithoutHuman();
            await this.executeAllowedTools();
            if (this.signal.aborted) {
                return this.cancel();
            }
            const suspended = await this.suspendIfPending();
            if (suspended) {
                return suspended;
            }
            const completed = await this.completeIfFinished();
            if (completed) {
                return completed;
            }
            const exhausted = await this.failIfExhausted();
            if (exhausted) {
                return exhausted;
            }
            const settled = await this.runModelStep();
            if (settled) {
                return settled;
            }
        }
    }

    // §11.2: exactly one input, validated against durable pending state.
    // Cancel inputs never reach here — run() short-circuits them before
    // materialization.
    private async applyInput(
        input: Exclude<TurnExternalInput, { type: "cancel" }>,
    ): Promise<void> {
        switch (input.type) {
            case "permission_decision": {
                const tc = this.state.toolCalls.find(
                    (t) => t.toolCallId === input.toolCallId,
                );
                if (!tc?.permission || tc.permission.resolved || tc.result) {
                    throw new TurnInputError(
                        `no pending permission for tool call ${input.toolCallId}`,
                    );
                }
                await this.append({
                    type: "tool_permission_resolved",
                    turnId: this.turnId,
                    ts: this.now(),
                    toolCallId: input.toolCallId,
                    decision: input.decision,
                    source: "human",
                    ...(input.metadata === undefined
                        ? {}
                        : { metadata: input.metadata }),
                });
                if (input.decision === "deny") {
                    await this.append(
                        runtimeResultEvent(this.turnId, this.now(), tc, {
                            output: "Permission denied by user.",
                            isError: true,
                        }),
                    );
                }
                return undefined;
            }
            case "async_tool_progress": {
                const tc = this.requirePendingAsync(input.toolCallId);
                await this.append({
                    type: "tool_progress",
                    turnId: this.turnId,
                    ts: this.now(),
                    toolCallId: tc.toolCallId,
                    source: "async",
                    progress: input.progress,
                });
                return undefined;
            }
            case "async_tool_result": {
                const tc = this.requirePendingAsync(input.toolCallId);
                await this.append({
                    type: "tool_result",
                    turnId: this.turnId,
                    ts: this.now(),
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    source: "async",
                    result: input.result,
                });
                return undefined;
            }
        }
    }

    private requirePendingAsync(toolCallId: string): ToolCallState {
        const tc = this.state.toolCalls.find((t) => t.toolCallId === toolCallId);
        if (!tc?.invocation || tc.execution !== "async" || tc.result) {
            throw new TurnInputError(`no pending async tool call ${toolCallId}`);
        }
        return tc;
    }

    // §23: a model call interrupted by a crash is closed as failed and later
    // re-issued by the normal model step (counting against the budget).
    private async closeInterruptedModelCall(): Promise<boolean> {
        const open = this.state.modelCalls.find(
            (c) => c.response === undefined && c.error === undefined,
        );
        if (!open) {
            return false;
        }
        await this.append(
            modelCallFailedEvent(
                this.turnId,
                this.now(),
                open.index,
                "model call was interrupted before a response was recorded",
            ),
        );
        return true;
    }

    // §23: a sync invocation interrupted by a crash gets an indeterminate
    // error result; the turn continues (tool problems are conversational).
    private async closeInterruptedSyncTools(): Promise<boolean> {
        const interrupted = this.state.toolCalls.filter(
            (tc) => tc.invocation && tc.execution === "sync" && !tc.result,
        );
        if (interrupted.length === 0) {
            return false;
        }
        for (const tc of interrupted) {
            await this.append(
                runtimeResultEvent(this.turnId, this.now(), tc, {
                    output: INTERRUPTED_TOOL_MESSAGE,
                    isError: true,
                }),
            );
        }
        return true;
    }

    // §9/§10: for freshly extracted tool calls — unknown tools and
    // human-dependent tools settle immediately; everything else is checked.
    // A checker throw fails closed (recorded, never auto-executed).
    private async evaluatePermissions(): Promise<void> {
        const fresh = this.state.toolCalls.filter(
            (tc) =>
                !tc.result &&
                !tc.invocation &&
                !tc.permission &&
                !this.checkerAllowed.has(tc.toolCallId),
        );
        for (const tc of fresh) {
            if (this.signal.aborted) {
                return;
            }
            const tool = this.toolsByName.get(tc.toolName);
            if (!tool) {
                await this.append(
                    runtimeResultEvent(this.turnId, this.now(), tc, {
                        output: `Unknown tool: ${tc.toolName}`,
                        isError: true,
                    }),
                );
                continue;
            }
            if (
                tool.descriptor.requiresHuman &&
                !this.definition.config.humanAvailable
            ) {
                await this.append(
                    invocationEvent(this.turnId, this.now(), tc, tool.descriptor),
                );
                await this.append(
                    runtimeResultEvent(this.turnId, this.now(), tc, {
                        output: "Human input is unavailable for this turn.",
                        isError: true,
                    }),
                );
                continue;
            }
            try {
                const check = await this.permissionChecker.check({
                    turnId: this.turnId,
                    toolCallId: tc.toolCallId,
                    toolId: tool.descriptor.toolId,
                    toolName: tc.toolName,
                    input: tc.input,
                });
                if (!check.required) {
                    this.checkerAllowed.add(tc.toolCallId);
                } else {
                    await this.append(
                        permissionRequiredEvent(
                            this.turnId,
                            this.now(),
                            tc,
                            check.request,
                        ),
                    );
                }
            } catch (error) {
                await this.append(
                    permissionRequiredEvent(
                        this.turnId,
                        this.now(),
                        tc,
                        {},
                        errorMessage(error),
                    ),
                );
            }
        }
    }

    // Conversation context for the classifier: resolved context, the turn
    // input, and completed assistant responses (the current batch's tool
    // results are not yet terminal, so tool messages are omitted).
    private conversationSoFar(): Array<z.infer<typeof ConversationMessage>> {
        const messages: Array<z.infer<typeof ConversationMessage>> = [
            this.state.definition.input,
        ];
        for (const call of this.state.modelCalls) {
            if (call.response !== undefined) {
                messages.push(call.response);
            }
        }
        return [...this.resolvedContext, ...messages];
    }

    // §9.3: one classifier batch per model response in auto mode.
    // Checker-error calls and previously failed classifications skip the
    // classifier and go straight to the human/deny fallback.
    private async classifyBatch(): Promise<void> {
        if (!this.definition.config.autoPermission) {
            return;
        }
        const candidates = this.state.toolCalls.filter(
            (tc) =>
                tc.permission &&
                !tc.permission.resolved &&
                !tc.permission.classification &&
                !tc.permission.classificationFailed &&
                tc.permission.required.checkerError === undefined &&
                !tc.result,
        );
        if (candidates.length === 0) {
            return;
        }
        let decisions;
        try {
            decisions = await this.permissionClassifier.classify(
                {
                    turnId: this.turnId,
                    messages: this.conversationSoFar(),
                    requests: candidates.map((tc) => ({
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        input: tc.input,
                        request: (tc.permission as NonNullable<ToolCallState["permission"]>)
                            .required.request,
                    })),
                },
                this.signal,
            );
        } catch (error) {
            if (this.signal.aborted) {
                return;
            }
            await this.append({
                type: "tool_permission_classification_failed",
                turnId: this.turnId,
                ts: this.now(),
                toolCallIds: candidates.map((c) => c.toolCallId),
                error: errorMessage(error),
            });
            return;
        }
        for (const tc of candidates) {
            const decision = decisions.find((d) => d.toolCallId === tc.toolCallId);
            if (!decision) {
                await this.append({
                    type: "tool_permission_classification_failed",
                    turnId: this.turnId,
                    ts: this.now(),
                    toolCallIds: [tc.toolCallId],
                    error: "classifier returned no decision",
                });
                continue;
            }
            await this.append({
                type: "tool_permission_classified",
                turnId: this.turnId,
                ts: this.now(),
                toolCallId: tc.toolCallId,
                decision: decision.decision,
                reason: decision.reason,
            });
            if (decision.decision === "allow") {
                await this.append(
                    resolvedEvent(
                        this.turnId,
                        this.now(),
                        tc.toolCallId,
                        "allow",
                        "classifier",
                        decision.reason,
                    ),
                );
            } else if (decision.decision === "deny") {
                await this.append(
                    resolvedEvent(
                        this.turnId,
                        this.now(),
                        tc.toolCallId,
                        "deny",
                        "classifier",
                        decision.reason,
                    ),
                );
                await this.append(
                    runtimeResultEvent(this.turnId, this.now(), tc, {
                        output: `Permission denied: ${decision.reason}`,
                        isError: true,
                    }),
                );
            }
            // "defer" falls through to the human/deny fallback.
        }
    }

    // §9.3 matrix, humanAvailable = false: deny whatever remains unresolved.
    private async denyUnresolvedWithoutHuman(): Promise<void> {
        if (this.definition.config.humanAvailable) {
            return;
        }
        const unresolved = this.state.toolCalls.filter(
            (tc) => tc.permission && !tc.permission.resolved && !tc.result,
        );
        for (const tc of unresolved) {
            await this.append(
                resolvedEvent(
                    this.turnId,
                    this.now(),
                    tc.toolCallId,
                    "deny",
                    "human_unavailable",
                ),
            );
            await this.append(
                runtimeResultEvent(this.turnId, this.now(), tc, {
                    output: "Permission denied: no human is available for this turn.",
                    isError: true,
                }),
            );
        }
    }

    // §10.5: record invocations for allowed tools serially in source order,
    // then execute the sync ones concurrently (async tools are exposed by
    // their invocation; results arrive through advanceTurn). Invocations are
    // durable before any execution starts, and commits are serialized by
    // append's internal queue, so the log prefix is deterministic while
    // results land in completion order. Tool failures are conversational,
    // not terminal.
    private async executeAllowedTools(): Promise<void> {
        const executable = this.state.toolCalls.filter(
            (tc) =>
                !tc.result &&
                !tc.invocation &&
                (this.checkerAllowed.has(tc.toolCallId) ||
                    tc.permission?.resolved?.decision === "allow"),
        );
        const started: Array<{ tc: ToolCallState; tool: SyncRuntimeTool }> = [];
        for (const tc of executable) {
            if (this.signal.aborted) {
                // Invoked-but-unexecuted calls get their cancelled results
                // from cancel(), same as before this loop ran.
                return;
            }
            const tool = this.toolsByName.get(tc.toolName);
            if (!tool) {
                await this.append(
                    runtimeResultEvent(this.turnId, this.now(), tc, {
                        output: `Unknown tool: ${tc.toolName}`,
                        isError: true,
                    }),
                );
                continue;
            }
            await this.append(
                invocationEvent(this.turnId, this.now(), tc, tool.descriptor),
            );
            if (tool.descriptor.execution === "async") {
                continue; // exposed; the result arrives through advanceTurn
            }
            started.push({ tc, tool: tool as SyncRuntimeTool });
        }
        // Each task settles its own call (result or error), so Promise.all
        // never rejects and one slow tool never blocks its siblings.
        await Promise.all(
            started.map(({ tc, tool }) => this.executeSyncTool(tc, tool)),
        );
    }

    private async executeSyncTool(
        tc: ToolCallState,
        syncTool: SyncRuntimeTool,
    ): Promise<void> {
        // The try covers tool execution only (including parsing its return —
        // a tool returning garbage is a tool error). The success-result
        // append stays OUTSIDE: a repository failure there must reject the
        // invocation as infrastructure, never masquerade as a failed tool —
        // the side effect already happened, and a durable false error would
        // invite the model to retry it (§21.4).
        let settled: z.infer<typeof ToolResultData>;
        try {
            const result = await syncTool.execute(tc.input, {
                turnId: this.turnId,
                toolCallId: tc.toolCallId,
                signal: this.signal,
                reportProgress: async (progress) => {
                    await this.append({
                        type: "tool_progress",
                        turnId: this.turnId,
                        ts: this.now(),
                        toolCallId: tc.toolCallId,
                        source: "sync",
                        progress,
                    });
                },
            });
            settled = ToolResultData.parse(result);
        } catch (error) {
            if (this.signal.aborted) {
                await this.append(
                    runtimeResultEvent(this.turnId, this.now(), tc, {
                        output: "Tool execution was cancelled.",
                        isError: true,
                    }),
                );
                return;
            }
            await this.append({
                type: "tool_result",
                turnId: this.turnId,
                ts: this.now(),
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                source: "sync",
                result: { output: errorMessage(error), isError: true },
            });
            return;
        }
        await this.append({
            type: "tool_result",
            turnId: this.turnId,
            ts: this.now(),
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            source: "sync",
            result: settled,
        });
        await this.maybeExtendTools(tc, settled);
    }

    // Mid-turn toolset extension (the one sanctioned exception to per-turn
    // tool immutability): a successful sync tool may carry additional
    // descriptors in result.metadata.toolAdditions — loadSkill attaching a
    // skill's declared tools. Descriptors resolve to live implementations
    // first; unresolvable ones are dropped so the durable event only ever
    // records tools a re-advance can also resolve. The dedupe against the
    // current effective set and the tools_extended append run atomically in
    // one serialized commit slot, so concurrent extensions cannot race the
    // reducer's collision check. Subsequent model calls in this turn see the
    // added tools via effectiveTools.
    private async maybeExtendTools(
        tc: ToolCallState,
        result: z.infer<typeof ToolResultData>,
    ): Promise<void> {
        if (result.isError) {
            return;
        }
        const additions = parseToolAdditions(result.metadata);
        if (!additions) {
            return;
        }
        const live = new Map<string, RuntimeTool>();
        const candidates: Array<z.infer<typeof ToolDescriptor>> = [];
        for (const descriptor of additions.tools) {
            if (live.has(descriptor.name)) {
                continue; // duplicate within the payload
            }
            try {
                const tool = await this.resolveTool(descriptor);
                if (
                    tool.descriptor.toolId !== descriptor.toolId ||
                    tool.descriptor.execution !== descriptor.execution
                ) {
                    continue;
                }
                live.set(descriptor.name, tool);
                candidates.push(descriptor);
            } catch {
                // No live implementation — skip the tool; the result that
                // carried it (e.g. the skill guidance) still stands.
            }
        }
        if (candidates.length === 0) {
            return;
        }
        let added: Array<z.infer<typeof ToolDescriptor>> = [];
        await this.appendWith(() => {
            const attached = new Set(
                effectiveTools(
                    this.state,
                    this.state.modelCalls.length,
                    this.resolvedAgent.tools,
                ).map((tool) => tool.name),
            );
            added = candidates.filter(
                (descriptor) => !attached.has(descriptor.name),
            );
            if (added.length === 0) {
                return undefined;
            }
            return [
                {
                    type: "tools_extended",
                    turnId: this.turnId,
                    ts: this.now(),
                    toolCallId: tc.toolCallId,
                    source: additions.source,
                    tools: added,
                },
            ];
        });
        for (const descriptor of added) {
            const tool = live.get(descriptor.name);
            if (tool) {
                this.toolsByName.set(descriptor.name, tool);
            }
        }
    }

    // §11.1: settle suspended while external work remains. A no-input
    // re-advance of an already-snapshotted suspension appends nothing.
    private async suspendIfPending(): Promise<TurnOutcome | undefined> {
        const pendingPerms = outstandingPermissions(this.state);
        const pendingAsync = outstandingAsyncTools(this.state);
        if (pendingPerms.length + pendingAsync.length === 0) {
            return undefined;
        }
        const last = this.events[this.events.length - 1];
        if (this.appended || last.type !== "turn_suspended") {
            await this.append({
                type: "turn_suspended",
                turnId: this.turnId,
                ts: this.now(),
                pendingPermissions: permissionsSnapshot(pendingPerms),
                pendingAsyncTools: asyncSnapshot(pendingAsync),
                usage: this.state.usage,
            });
        }
        return {
            status: "suspended",
            pendingPermissions: permissionsSnapshot(pendingPerms),
            pendingAsyncTools: asyncSnapshot(pendingAsync),
            usage: this.state.usage,
        };
    }

    // §8.5: a completed response without tool calls completes the turn.
    private async completeIfFinished(): Promise<TurnOutcome | undefined> {
        const lastCall = this.state.modelCalls[this.state.modelCalls.length - 1];
        if (
            lastCall?.response === undefined ||
            this.state.toolCalls.some((tc) => tc.modelCallIndex === lastCall.index)
        ) {
            return undefined;
        }
        const output = lastCall.response;
        const finishReason = lastCall.finishReason ?? "unknown";
        await this.append({
            type: "turn_completed",
            turnId: this.turnId,
            ts: this.now(),
            output,
            finishReason,
            usage: this.state.usage,
        });
        return { status: "completed", output, finishReason, usage: this.state.usage };
    }

    // §20: limit exhaustion is a distinguishable outcome; the transcript is
    // structurally complete, so sessions can offer continuation.
    private async failIfExhausted(): Promise<TurnOutcome | undefined> {
        if (this.state.modelCalls.length < this.definition.config.maxModelCalls) {
            return undefined;
        }
        const error = `Model call limit of ${this.definition.config.maxModelCalls} reached before the turn completed.`;
        await this.append({
            type: "turn_failed",
            turnId: this.turnId,
            ts: this.now(),
            error,
            code: MODEL_CALL_LIMIT_ERROR_CODE,
            usage: this.state.usage,
        });
        return {
            status: "failed",
            error,
            code: MODEL_CALL_LIMIT_ERROR_CODE,
            usage: this.state.usage,
        };
    }

    // §8.3/§18h–l: one model step. The durable request barrier precedes the
    // provider call; step events persist before the next provider read;
    // deltas bypass storage. The request records only REFERENCES to what is
    // new since the previous call; the payload actually sent is built by the
    // shared composer over the durable state, so file + composer reproduce
    // the wire bytes exactly. Returns an outcome only on failure/cancel.
    private async runModelStep(): Promise<TurnOutcome | undefined> {
        const index = this.state.modelCalls.length;
        const context = this.definition.context;
        const isRef = !Array.isArray(context);
        let refs: string[];
        if (index === 0) {
            refs =
                !isRef && context.length > 0
                    ? ["context", "input"]
                    : ["input"];
        } else {
            const previous = this.state.modelCalls[index - 1];
            refs =
                previous.response !== undefined
                    ? [
                          assistantRef(previous.index),
                          ...this.state.toolCalls
                              .filter((tc) => tc.modelCallIndex === previous.index)
                              .sort((a, b) => a.order - b.order)
                              .map((tc) => toolResultRef(tc.toolCallId)),
                      ]
                    : []; // re-issue after an interrupted call adds nothing new
        }
        // The turn's reasoning effort is stamped on every call's persisted
        // parameters (turn-runtime-design.md §8.3): each step durably records
        // what it ran with, and the model bridge maps the canonical value to
        // provider-specific options at invoke time.
        const reasoningEffort = this.definition.config.reasoningEffort;
        const request: z.infer<typeof ModelRequest> = {
            ...(isRef && index === 0 ? { contextRef: context } : {}),
            messages: refs,
            parameters:
                reasoningEffort === undefined ? {} : { reasoningEffort },
        };
        await this.append({
            type: "model_call_requested",
            turnId: this.turnId,
            ts: this.now(),
            modelCallIndex: index,
            request,
        });

        const composed = composeModelRequest(
            this.state,
            index,
            this.resolvedContext,
            this.resolvedAgent,
            (messages) => this.model.encodeMessages(messages),
        );

        let completion: Extract<LlmStreamEvent, { type: "completed" }> | null =
            null;
        try {
            for await (const event of this.model.stream({
                systemPrompt: composed.systemPrompt,
                messages: composed.messages,
                tools: composed.tools,
                parameters: composed.parameters,
                signal: this.signal,
            })) {
                switch (event.type) {
                    case "text_delta":
                        this.pushDelta({
                            type: "text_delta",
                            turnId: this.turnId,
                            modelCallIndex: index,
                            delta: event.delta,
                        });
                        break;
                    case "reasoning_delta":
                        this.pushDelta({
                            type: "reasoning_delta",
                            turnId: this.turnId,
                            modelCallIndex: index,
                            delta: event.delta,
                        });
                        break;
                    case "step_event":
                        await this.append({
                            type: "model_step_event",
                            turnId: this.turnId,
                            ts: this.now(),
                            modelCallIndex: index,
                            event: event.event,
                        });
                        break;
                    case "completed":
                        completion = event;
                        break;
                }
            }
            if (!completion) {
                throw new Error("model stream ended without a completed response");
            }
        } catch (error) {
            if (this.signal.aborted) {
                await this.append(
                    modelCallFailedEvent(
                        this.turnId,
                        this.now(),
                        index,
                        "model call was cancelled",
                    ),
                );
                return this.cancel();
            }
            const message = errorMessage(error);
            await this.append(
                modelCallFailedEvent(this.turnId, this.now(), index, message),
            );
            await this.append({
                type: "turn_failed",
                turnId: this.turnId,
                ts: this.now(),
                error: message,
                usage: this.state.usage,
            });
            return { status: "failed", error: message, usage: this.state.usage };
        }

        await this.append({
            type: "model_call_completed",
            turnId: this.turnId,
            ts: this.now(),
            modelCallIndex: index,
            message: completion.message,
            finishReason: completion.finishReason,
            usage: completion.usage,
            ...(completion.providerMetadata === undefined
                ? {}
                : { providerMetadata: completion.providerMetadata }),
        });
        // Analytics after the durable barrier; a reporter failure must never
        // affect the turn.
        try {
            this.usageReporter.reportModelUsage({
                agentId: this.resolvedAgent.agentId,
                model: this.resolvedAgent.model,
                usage: completion.usage,
            });
        } catch {
            // best effort
        }
        return undefined;
    }

    // §22: close any open model call, give synthetic results to unresolved
    // calls, and append the terminal cancellation.
    private async cancel(): Promise<TurnOutcome> {
        const open = this.state.modelCalls.find(
            (c) => c.response === undefined && c.error === undefined,
        );
        if (open) {
            await this.append(
                modelCallFailedEvent(
                    this.turnId,
                    this.now(),
                    open.index,
                    "model call was cancelled",
                ),
            );
        }
        for (const tc of this.state.toolCalls.filter((t) => !t.result)) {
            await this.append(
                runtimeResultEvent(this.turnId, this.now(), tc, {
                    output: "Tool call was cancelled before completion.",
                    isError: true,
                }),
            );
        }
        await this.append({
            type: "turn_cancelled",
            turnId: this.turnId,
            ts: this.now(),
            ...(this.cancelReason === undefined
                ? {}
                : { reason: this.cancelReason }),
            usage: this.state.usage,
        });
        return {
            status: "cancelled",
            ...(this.cancelReason === undefined ? {} : { reason: this.cancelReason }),
            usage: this.state.usage,
        };
    }
}

// The metadata contract populated by the tool-registry bridge from a
// builtin's reserved $toolAdditions return key (application/lib/
// tool-additions.ts). Anything malformed is ignored — a bad payload must
// never corrupt the turn.
const ToolAdditionsMetadata = z.object({
    toolAdditions: z.object({
        source: z.string(),
        tools: z.array(ToolDescriptor).min(1),
    }),
});

function parseToolAdditions(
    metadata: JsonValue | undefined,
): { source: string; tools: Array<z.infer<typeof ToolDescriptor>> } | undefined {
    if (metadata === undefined) {
        return undefined;
    }
    const parsed = ToolAdditionsMetadata.safeParse(metadata);
    return parsed.success ? parsed.data.toolAdditions : undefined;
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    // Provider API errors carry the actual upstream failure in responseBody
    // (AI SDK APICallError; RetryError wraps the last one as lastError).
    // "Failed after 3 attempts" alone is undebuggable — persist the payload,
    // bounded so request events stay reference-sized.
    const source = (error as { lastError?: unknown }).lastError ?? error;
    const statusCode = (source as { statusCode?: unknown }).statusCode;
    const responseBody = (source as { responseBody?: unknown }).responseBody;
    const details: string[] = [];
    if (typeof statusCode === "number") {
        details.push(`status ${statusCode}`);
    }
    if (typeof responseBody === "string" && responseBody.trim().length > 0) {
        details.push(responseBody.slice(0, 2000));
    }
    return details.length > 0 ? `${message} [${details.join(" — ")}]` : message;
}

function outcomeFromTerminal(state: TurnState): TurnOutcome {
    const terminal = state.terminal;
    if (!terminal) {
        throw new Error("turn is not terminal");
    }
    switch (terminal.type) {
        case "turn_completed":
            return {
                status: "completed",
                output: terminal.output,
                finishReason: terminal.finishReason,
                usage: terminal.usage,
            };
        case "turn_failed":
            return {
                status: "failed",
                error: terminal.error,
                ...(terminal.code === undefined ? {} : { code: terminal.code }),
                usage: terminal.usage,
            };
        case "turn_cancelled":
            return {
                status: "cancelled",
                ...(terminal.reason === undefined ? {} : { reason: terminal.reason }),
                usage: terminal.usage,
            };
    }
}

function permissionsSnapshot(
    calls: ToolCallState[],
): z.infer<typeof TurnSuspended>["pendingPermissions"] {
    return calls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        request: (tc.permission as NonNullable<ToolCallState["permission"]>)
            .required.request,
    }));
}

function asyncSnapshot(
    calls: ToolCallState[],
): z.infer<typeof TurnSuspended>["pendingAsyncTools"] {
    return calls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolId: (tc.invocation as z.infer<typeof ToolInvocationRequested>).toolId,
        toolName: tc.toolName,
        input: (tc.invocation as z.infer<typeof ToolInvocationRequested>).input,
    }));
}

function modelCallFailedEvent(
    turnId: string,
    ts: string,
    modelCallIndex: number,
    error: string,
): z.infer<typeof ModelCallFailed> {
    return { type: "model_call_failed", turnId, ts, modelCallIndex, error };
}

function runtimeResultEvent(
    turnId: string,
    ts: string,
    tc: ToolCallState,
    result: { output: JsonValue; isError: boolean },
): z.infer<typeof ToolResult> {
    return {
        type: "tool_result",
        turnId,
        ts,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        source: "runtime",
        result,
    };
}

function permissionRequiredEvent(
    turnId: string,
    ts: string,
    tc: ToolCallState,
    request: JsonValue,
    checkerError?: string,
): z.infer<typeof ToolPermissionRequired> {
    return {
        type: "tool_permission_required",
        turnId,
        ts,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        request,
        ...(checkerError === undefined ? {} : { checkerError }),
    };
}

function resolvedEvent(
    turnId: string,
    ts: string,
    toolCallId: string,
    decision: "allow" | "deny",
    source: z.infer<typeof ToolPermissionResolved>["source"],
    reason?: string,
): z.infer<typeof ToolPermissionResolved> {
    return {
        type: "tool_permission_resolved",
        turnId,
        ts,
        toolCallId,
        decision,
        source,
        ...(reason === undefined ? {} : { reason }),
    };
}

function invocationEvent(
    turnId: string,
    ts: string,
    tc: ToolCallState,
    descriptor: z.infer<typeof ToolDescriptor>,
): z.infer<typeof ToolInvocationRequested> {
    return {
        type: "tool_invocation_requested",
        turnId,
        ts,
        toolCallId: tc.toolCallId,
        toolId: descriptor.toolId,
        toolName: tc.toolName,
        execution: descriptor.execution,
        input: (tc.input ?? null) as JsonValue,
    };
}
