import type { z } from "zod";
import {
    DEFAULT_MAX_MODEL_CALLS,
    MODEL_CALL_LIMIT_ERROR_CODE,
    type ConversationMessage,
    type JsonValue,
    type ModelCallFailed,
    type ModelRequest,
    type ToolCallState,
    type ToolDescriptor,
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
    outstandingAsyncTools,
    outstandingPermissions,
    reduceTurn,
    turnTranscript,
} from "@x/shared/dist/turns.js";
import type { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
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
    bus: ITurnLifecycleBus;
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
    private readonly bus: ITurnLifecycleBus;

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
        bus,
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
        this.bus = bus;
    }

    async createTurn(input: CreateTurnInput): Promise<string> {
        const resolved = await this.agentResolver.resolve(input.agent);
        const turnId = await this.idGenerator.next();
        const event = TurnCreated.parse({
            type: "turn_created",
            schemaVersion: 1,
            turnId,
            ts: this.clock.now(),
            sessionId: input.sessionId ?? null,
            agent: { requested: input.agent, resolved },
            context: input.context,
            input: input.input,
            config: {
                autoPermission: input.config.autoPermission ?? false,
                humanAvailable: input.config.humanAvailable,
                maxModelCalls: input.config.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
            },
        });
        await this.turnRepo.create(event);
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
        this.bus.publish({ type: "turn-processing-start", turnId });
        try {
            return await this.advance(turnId, input, externalSignal, stream);
        } finally {
            this.bus.publish({ type: "turn-processing-end", turnId });
        }
    }

    // §18 steps 4–7: read, reduce, short-circuit terminal turns, materialize
    // context, and validate live dependencies — all before any mutation.
    // Failures here are infrastructure errors: the execution rejects and the
    // turn is left unchanged.
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
        const resolvedContext = await this.contextResolver.resolve(
            definition.context,
        );
        const model = await this.modelRegistry.resolve(
            definition.agent.resolved.model,
        );
        const toolsByName = new Map<string, RuntimeTool>();
        for (const descriptor of definition.agent.resolved.tools) {
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
            resolvedContext,
            model,
            toolsByName,
            signal: controller.signal,
            turnRepo: this.turnRepo,
            clock: this.clock,
            permissionChecker: this.permissionChecker,
            permissionClassifier: this.permissionClassifier,
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

// One advanceTurn invocation. Owns the per-invocation context and implements
// the §18 main loop as one method per phase. All state it acts on is derived
// from the durable log via the shared reducer after every append.
class TurnAdvance {
    private readonly turnId: string;
    private readonly events: TEvent[];
    private state: TurnState;
    private readonly stream: HotStream<TurnStreamEvent, TurnOutcome>;
    private readonly resolvedContext: Array<z.infer<typeof ConversationMessage>>;
    private readonly model: ResolvedModel;
    private readonly toolsByName: Map<string, RuntimeTool>;
    private readonly signal: AbortSignal;
    private readonly turnRepo: ITurnRepo;
    private readonly clock: IClock;
    private readonly permissionChecker: IPermissionChecker;
    private readonly permissionClassifier: IPermissionClassifier;

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
        resolvedContext: Array<z.infer<typeof ConversationMessage>>;
        model: ResolvedModel;
        toolsByName: Map<string, RuntimeTool>;
        signal: AbortSignal;
        turnRepo: ITurnRepo;
        clock: IClock;
        permissionChecker: IPermissionChecker;
        permissionClassifier: IPermissionClassifier;
    }) {
        this.turnId = init.turnId;
        this.events = init.events;
        this.state = init.state;
        this.stream = init.stream;
        this.resolvedContext = init.resolvedContext;
        this.model = init.model;
        this.toolsByName = init.toolsByName;
        this.signal = init.signal;
        this.turnRepo = init.turnRepo;
        this.clock = init.clock;
        this.permissionChecker = init.permissionChecker;
        this.permissionClassifier = init.permissionClassifier;
    }

    private get definition(): TurnState["definition"] {
        return this.state.definition;
    }

    private now(): string {
        return this.clock.now();
    }

    // Durable barrier: persist, re-reduce (the reducer doubles as a runtime
    // assertion that the appended history is legal), then stream.
    private async append(...batch: TEvent[]): Promise<void> {
        await this.turnRepo.append(this.turnId, batch);
        this.events.push(...batch);
        this.state = reduceTurn(this.events);
        this.appended = true;
        for (const event of batch) {
            this.stream.push(event);
        }
    }

    // §18 step 8: repeatedly advance deterministic work. Each phase either
    // appends durable facts and lets the loop continue, or produces the
    // invocation's outcome.
    async run(input: TurnExternalInput | undefined): Promise<TurnOutcome> {
        if (input) {
            const cancelled = await this.applyInput(input);
            if (cancelled) {
                return cancelled;
            }
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
    // Returns an outcome only for cancel inputs.
    private async applyInput(
        input: TurnExternalInput,
    ): Promise<TurnOutcome | undefined> {
        switch (input.type) {
            case "cancel":
                this.cancelReason = input.reason;
                return this.cancel();
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
                candidates.map((tc) => ({
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    input: tc.input,
                    request: (tc.permission as NonNullable<ToolCallState["permission"]>)
                        .required.request,
                })),
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

    // §10.5: execute allowed sync tools sequentially and expose allowed async
    // tools, in source order. Tool failures are conversational, not terminal.
    private async executeAllowedTools(): Promise<void> {
        const executable = this.state.toolCalls.filter(
            (tc) =>
                !tc.result &&
                !tc.invocation &&
                (this.checkerAllowed.has(tc.toolCallId) ||
                    tc.permission?.resolved?.decision === "allow"),
        );
        for (const tc of executable) {
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
            await this.append(
                invocationEvent(this.turnId, this.now(), tc, tool.descriptor),
            );
            if (tool.descriptor.execution === "async") {
                continue; // exposed; the result arrives through advanceTurn
            }
            const syncTool = tool as SyncRuntimeTool;
            try {
                const result = await syncTool.execute(tc.input, {
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
                await this.append({
                    type: "tool_result",
                    turnId: this.turnId,
                    ts: this.now(),
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    source: "sync",
                    result: ToolResultData.parse(result),
                });
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
    // deltas bypass storage. Returns an outcome only on failure/cancel.
    private async runModelStep(): Promise<TurnOutcome | undefined> {
        const index = this.state.modelCalls.length;
        const transcript = turnTranscript(this.state);
        const context = this.definition.context;
        const isRef = !Array.isArray(context);
        const request: z.infer<typeof ModelRequest> = {
            systemPrompt: this.definition.agent.resolved.systemPrompt,
            ...(isRef ? { contextRef: context } : {}),
            messages: isRef ? transcript : [...context, ...transcript],
            tools: this.definition.agent.resolved.tools,
            parameters: {},
        };
        await this.append({
            type: "model_call_requested",
            turnId: this.turnId,
            ts: this.now(),
            modelCallIndex: index,
            request,
        });

        let completion: Extract<LlmStreamEvent, { type: "completed" }> | null =
            null;
        try {
            for await (const event of this.model.stream({
                systemPrompt: request.systemPrompt,
                messages: [...this.resolvedContext, ...transcript],
                tools: request.tools,
                parameters: request.parameters,
                signal: this.signal,
            })) {
                switch (event.type) {
                    case "text_delta":
                        this.stream.push({
                            type: "text_delta",
                            turnId: this.turnId,
                            modelCallIndex: index,
                            delta: event.delta,
                        });
                        break;
                    case "reasoning_delta":
                        this.stream.push({
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
