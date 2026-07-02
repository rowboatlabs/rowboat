import type { z } from "zod";
import {
    DEFAULT_MAX_MODEL_CALLS,
    MODEL_CALL_LIMIT_ERROR_CODE,
    type JsonValue,
    type ModelCallFailed,
    type ModelRequest,
    type ToolCallState,
    type ToolInvocationRequested,
    ToolResultData,
    type ToolDescriptor,
    type ToolPermissionRequired,
    type ToolPermissionResolved,
    type ToolResult,
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
import type { IModelRegistry, LlmStreamEvent } from "./model-registry.js";
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

    private async advance(
        turnId: string,
        input: TurnExternalInput | undefined,
        externalSignal: AbortSignal | undefined,
        stream: HotStream<TurnStreamEvent, TurnOutcome>,
    ): Promise<TurnOutcome> {
        const events = await this.turnRepo.read(turnId);
        let state = reduceTurn(events);

        if (state.terminal) {
            if (input) {
                throw new TurnInputError(
                    `turn ${turnId} is terminal; input rejected`,
                );
            }
            return outcomeFromTerminal(state);
        }

        const definition = state.definition;

        // Materialize context and live dependencies. Failures here are
        // infrastructure errors: the execution rejects, the turn is unchanged.
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

        let appended = false;
        const append = async (...batch: TEvent[]): Promise<void> => {
            await this.turnRepo.append(turnId, batch);
            events.push(...batch);
            state = reduceTurn(events);
            appended = true;
            for (const event of batch) {
                stream.push(event);
            }
        };
        const now = () => this.clock.now();
        // Checker "allowed" outcomes are deliberately not durable: after a
        // crash the checker is simply re-consulted.
        const checkerAllowed = new Set<string>();
        let cancelReason: string | undefined;

        const cancelTurn = async (): Promise<TurnOutcome> => {
            const open = state.modelCalls.find(
                (c) => c.response === undefined && c.error === undefined,
            );
            if (open) {
                await append(
                    modelCallFailedEvent(turnId, now(), open.index, "model call was cancelled"),
                );
            }
            for (const tc of state.toolCalls.filter((t) => !t.result)) {
                await append(
                    runtimeResultEvent(turnId, now(), tc, {
                        output: "Tool call was cancelled before completion.",
                        isError: true,
                    }),
                );
            }
            await append({
                type: "turn_cancelled",
                turnId,
                ts: now(),
                ...(cancelReason === undefined ? {} : { reason: cancelReason }),
                usage: state.usage,
            });
            return {
                status: "cancelled",
                ...(cancelReason === undefined ? {} : { reason: cancelReason }),
                usage: state.usage,
            };
        };

        try {
            // Apply the optional single external input against durable
            // pending state.
            if (input) {
                switch (input.type) {
                    case "cancel":
                        cancelReason = input.reason;
                        return await cancelTurn();
                    case "permission_decision": {
                        const tc = state.toolCalls.find(
                            (t) => t.toolCallId === input.toolCallId,
                        );
                        if (!tc?.permission || tc.permission.resolved || tc.result) {
                            throw new TurnInputError(
                                `no pending permission for tool call ${input.toolCallId}`,
                            );
                        }
                        await append({
                            type: "tool_permission_resolved",
                            turnId,
                            ts: now(),
                            toolCallId: input.toolCallId,
                            decision: input.decision,
                            source: "human",
                            ...(input.metadata === undefined
                                ? {}
                                : { metadata: input.metadata }),
                        });
                        if (input.decision === "deny") {
                            await append(
                                runtimeResultEvent(turnId, now(), tc, {
                                    output: "Permission denied by user.",
                                    isError: true,
                                }),
                            );
                        }
                        break;
                    }
                    case "async_tool_progress": {
                        const tc = requirePendingAsync(state, input.toolCallId);
                        await append({
                            type: "tool_progress",
                            turnId,
                            ts: now(),
                            toolCallId: tc.toolCallId,
                            source: "async",
                            progress: input.progress,
                        });
                        break;
                    }
                    case "async_tool_result": {
                        const tc = requirePendingAsync(state, input.toolCallId);
                        await append({
                            type: "tool_result",
                            turnId,
                            ts: now(),
                            toolCallId: tc.toolCallId,
                            toolName: tc.toolName,
                            source: "async",
                            result: input.result,
                        });
                        break;
                    }
                }
            }

            for (;;) {
                if (controller.signal.aborted) {
                    return await cancelTurn();
                }

                // Recovery: close a model call interrupted by a crash, then
                // re-issue it as a new call (counts against the budget).
                const open = state.modelCalls.find(
                    (c) => c.response === undefined && c.error === undefined,
                );
                if (open) {
                    await append(
                        modelCallFailedEvent(
                            turnId,
                            now(),
                            open.index,
                            "model call was interrupted before a response was recorded",
                        ),
                    );
                    continue;
                }

                // Recovery: close sync invocations interrupted by a crash
                // with an indeterminate result; the turn continues.
                const interruptedSync = state.toolCalls.filter(
                    (tc) => tc.invocation && tc.execution === "sync" && !tc.result,
                );
                if (interruptedSync.length > 0) {
                    for (const tc of interruptedSync) {
                        await append(
                            runtimeResultEvent(turnId, now(), tc, {
                                output: INTERRUPTED_TOOL_MESSAGE,
                                isError: true,
                            }),
                        );
                    }
                    continue;
                }

                // Permission requirements for freshly extracted tool calls.
                const fresh = state.toolCalls.filter(
                    (tc) =>
                        !tc.result &&
                        !tc.invocation &&
                        !tc.permission &&
                        !checkerAllowed.has(tc.toolCallId),
                );
                for (const tc of fresh) {
                    if (controller.signal.aborted) {
                        break;
                    }
                    const tool = toolsByName.get(tc.toolName);
                    if (!tool) {
                        await append(
                            runtimeResultEvent(turnId, now(), tc, {
                                output: `Unknown tool: ${tc.toolName}`,
                                isError: true,
                            }),
                        );
                        continue;
                    }
                    if (
                        tool.descriptor.requiresHuman &&
                        !definition.config.humanAvailable
                    ) {
                        await append(
                            invocationEvent(turnId, now(), tc, tool.descriptor),
                        );
                        await append(
                            runtimeResultEvent(turnId, now(), tc, {
                                output: "Human input is unavailable for this turn.",
                                isError: true,
                            }),
                        );
                        continue;
                    }
                    try {
                        const check = await this.permissionChecker.check({
                            turnId,
                            toolCallId: tc.toolCallId,
                            toolId: tool.descriptor.toolId,
                            toolName: tc.toolName,
                            input: tc.input,
                        });
                        if (!check.required) {
                            checkerAllowed.add(tc.toolCallId);
                        } else {
                            await append(
                                permissionRequiredEvent(
                                    turnId,
                                    now(),
                                    tc,
                                    check.request,
                                ),
                            );
                        }
                    } catch (error) {
                        // Checker failure fails closed: record it and route
                        // to a human (or denial below); never execute.
                        await append(
                            permissionRequiredEvent(turnId, now(), tc, {}, errorMessage(error)),
                        );
                    }
                }
                if (controller.signal.aborted) {
                    return await cancelTurn();
                }

                // Automatic classification, one batch. Checker-error calls
                // and previously failed classifications go straight to the
                // human/deny fallback.
                if (definition.config.autoPermission) {
                    const candidates = state.toolCalls.filter(
                        (tc) =>
                            tc.permission &&
                            !tc.permission.resolved &&
                            !tc.permission.classification &&
                            !tc.permission.classificationFailed &&
                            tc.permission.required.checkerError === undefined &&
                            !tc.result,
                    );
                    if (candidates.length > 0) {
                        try {
                            const decisions = await this.permissionClassifier.classify(
                                candidates.map((tc) => ({
                                    toolCallId: tc.toolCallId,
                                    toolName: tc.toolName,
                                    input: tc.input,
                                    request: tc.permission!.required.request,
                                })),
                                controller.signal,
                            );
                            for (const tc of candidates) {
                                const decision = decisions.find(
                                    (d) => d.toolCallId === tc.toolCallId,
                                );
                                if (!decision) {
                                    await append({
                                        type: "tool_permission_classification_failed",
                                        turnId,
                                        ts: now(),
                                        toolCallIds: [tc.toolCallId],
                                        error: "classifier returned no decision",
                                    });
                                    continue;
                                }
                                await append({
                                    type: "tool_permission_classified",
                                    turnId,
                                    ts: now(),
                                    toolCallId: tc.toolCallId,
                                    decision: decision.decision,
                                    reason: decision.reason,
                                });
                                if (decision.decision === "allow") {
                                    await append(
                                        resolvedEvent(turnId, now(), tc.toolCallId, "allow", "classifier", decision.reason),
                                    );
                                } else if (decision.decision === "deny") {
                                    await append(
                                        resolvedEvent(turnId, now(), tc.toolCallId, "deny", "classifier", decision.reason),
                                    );
                                    await append(
                                        runtimeResultEvent(turnId, now(), tc, {
                                            output: `Permission denied: ${decision.reason}`,
                                            isError: true,
                                        }),
                                    );
                                }
                                // "defer" falls through to human/deny fallback.
                            }
                        } catch (error) {
                            if (controller.signal.aborted) {
                                return await cancelTurn();
                            }
                            await append({
                                type: "tool_permission_classification_failed",
                                turnId,
                                ts: now(),
                                toolCallIds: candidates.map((c) => c.toolCallId),
                                error: errorMessage(error),
                            });
                        }
                    }
                }

                // No human available: deny whatever remains unresolved.
                if (!definition.config.humanAvailable) {
                    const unresolved = state.toolCalls.filter(
                        (tc) => tc.permission && !tc.permission.resolved && !tc.result,
                    );
                    for (const tc of unresolved) {
                        await append(
                            resolvedEvent(turnId, now(), tc.toolCallId, "deny", "human_unavailable"),
                        );
                        await append(
                            runtimeResultEvent(turnId, now(), tc, {
                                output: "Permission denied: no human is available for this turn.",
                                isError: true,
                            }),
                        );
                    }
                }

                // Execute allowed sync tools sequentially; expose allowed
                // async tools. Source order.
                const executable = state.toolCalls.filter(
                    (tc) =>
                        !tc.result &&
                        !tc.invocation &&
                        (checkerAllowed.has(tc.toolCallId) ||
                            tc.permission?.resolved?.decision === "allow"),
                );
                for (const tc of executable) {
                    if (controller.signal.aborted) {
                        break;
                    }
                    const tool = toolsByName.get(tc.toolName);
                    if (!tool) {
                        await append(
                            runtimeResultEvent(turnId, now(), tc, {
                                output: `Unknown tool: ${tc.toolName}`,
                                isError: true,
                            }),
                        );
                        continue;
                    }
                    await append(invocationEvent(turnId, now(), tc, tool.descriptor));
                    if (tool.descriptor.execution === "async") {
                        continue;
                    }
                    const syncTool = tool as SyncRuntimeTool;
                    try {
                        const result = await syncTool.execute(tc.input, {
                            signal: controller.signal,
                            reportProgress: async (progress) => {
                                await append({
                                    type: "tool_progress",
                                    turnId,
                                    ts: now(),
                                    toolCallId: tc.toolCallId,
                                    source: "sync",
                                    progress,
                                });
                            },
                        });
                        await append({
                            type: "tool_result",
                            turnId,
                            ts: now(),
                            toolCallId: tc.toolCallId,
                            toolName: tc.toolName,
                            source: "sync",
                            result: ToolResultData.parse(result),
                        });
                    } catch (error) {
                        if (controller.signal.aborted) {
                            await append(
                                runtimeResultEvent(turnId, now(), tc, {
                                    output: "Tool execution was cancelled.",
                                    isError: true,
                                }),
                            );
                            break;
                        }
                        // A tool failure is conversational, not terminal.
                        await append({
                            type: "tool_result",
                            turnId,
                            ts: now(),
                            toolCallId: tc.toolCallId,
                            toolName: tc.toolName,
                            source: "sync",
                            result: { output: errorMessage(error), isError: true },
                        });
                    }
                }
                if (controller.signal.aborted) {
                    return await cancelTurn();
                }

                // Suspend while external work remains outstanding.
                const pendingPerms = outstandingPermissions(state);
                const pendingAsync = outstandingAsyncTools(state);
                if (pendingPerms.length + pendingAsync.length > 0) {
                    const last = events[events.length - 1];
                    if (appended || last.type !== "turn_suspended") {
                        await append({
                            type: "turn_suspended",
                            turnId,
                            ts: now(),
                            pendingPermissions: permissionsSnapshot(pendingPerms),
                            pendingAsyncTools: asyncSnapshot(pendingAsync),
                            usage: state.usage,
                        });
                    }
                    return {
                        status: "suspended",
                        pendingPermissions: permissionsSnapshot(pendingPerms),
                        pendingAsyncTools: asyncSnapshot(pendingAsync),
                        usage: state.usage,
                    };
                }

                // Tool batch complete. Completion, budget, or the next call.
                const lastCall = state.modelCalls[state.modelCalls.length - 1];
                if (
                    lastCall?.response !== undefined &&
                    state.toolCalls.every((tc) => tc.modelCallIndex !== lastCall.index)
                ) {
                    const output = lastCall.response;
                    const finishReason = lastCall.finishReason ?? "unknown";
                    await append({
                        type: "turn_completed",
                        turnId,
                        ts: now(),
                        output,
                        finishReason,
                        usage: state.usage,
                    });
                    return {
                        status: "completed",
                        output,
                        finishReason,
                        usage: state.usage,
                    };
                }

                if (state.modelCalls.length >= definition.config.maxModelCalls) {
                    const error = `Model call limit of ${definition.config.maxModelCalls} reached before the turn completed.`;
                    await append({
                        type: "turn_failed",
                        turnId,
                        ts: now(),
                        error,
                        code: MODEL_CALL_LIMIT_ERROR_CODE,
                        usage: state.usage,
                    });
                    return {
                        status: "failed",
                        error,
                        code: MODEL_CALL_LIMIT_ERROR_CODE,
                        usage: state.usage,
                    };
                }

                // One model step. The durable request barrier precedes the
                // provider call; step events persist before the next provider
                // stream read; deltas bypass storage.
                const index = state.modelCalls.length;
                const transcript = turnTranscript(state);
                const isRef = !Array.isArray(definition.context);
                const request: z.infer<typeof ModelRequest> = {
                    systemPrompt: definition.agent.resolved.systemPrompt,
                    ...(isRef ? { contextRef: definition.context as { previousTurnId: string } } : {}),
                    messages: isRef
                        ? transcript
                        : [...(definition.context as typeof transcript), ...transcript],
                    tools: definition.agent.resolved.tools,
                    parameters: {},
                };
                await append({
                    type: "model_call_requested",
                    turnId,
                    ts: now(),
                    modelCallIndex: index,
                    request,
                });

                let completion: Extract<
                    LlmStreamEvent,
                    { type: "completed" }
                > | null = null;
                try {
                    for await (const event of model.stream({
                        systemPrompt: request.systemPrompt,
                        messages: [...resolvedContext, ...transcript],
                        tools: request.tools,
                        parameters: request.parameters,
                        signal: controller.signal,
                    })) {
                        switch (event.type) {
                            case "text_delta":
                                stream.push({
                                    type: "text_delta",
                                    turnId,
                                    modelCallIndex: index,
                                    delta: event.delta,
                                });
                                break;
                            case "reasoning_delta":
                                stream.push({
                                    type: "reasoning_delta",
                                    turnId,
                                    modelCallIndex: index,
                                    delta: event.delta,
                                });
                                break;
                            case "step_event":
                                await append({
                                    type: "model_step_event",
                                    turnId,
                                    ts: now(),
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
                        throw new Error(
                            "model stream ended without a completed response",
                        );
                    }
                } catch (error) {
                    if (controller.signal.aborted) {
                        await append(
                            modelCallFailedEvent(turnId, now(), index, "model call was cancelled"),
                        );
                        return await cancelTurn();
                    }
                    const message = errorMessage(error);
                    await append(modelCallFailedEvent(turnId, now(), index, message));
                    await append({
                        type: "turn_failed",
                        turnId,
                        ts: now(),
                        error: message,
                        usage: state.usage,
                    });
                    return { status: "failed", error: message, usage: state.usage };
                }

                await append({
                    type: "model_call_completed",
                    turnId,
                    ts: now(),
                    modelCallIndex: index,
                    message: completion.message,
                    finishReason: completion.finishReason,
                    usage: completion.usage,
                    ...(completion.providerMetadata === undefined
                        ? {}
                        : { providerMetadata: completion.providerMetadata }),
                });
            }
        } finally {
            if (externalSignal) {
                externalSignal.removeEventListener("abort", forwardAbort);
            }
        }
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

function requirePendingAsync(state: TurnState, toolCallId: string): ToolCallState {
    const tc = state.toolCalls.find((t) => t.toolCallId === toolCallId);
    if (!tc?.invocation || tc.execution !== "async" || tc.result) {
        throw new TurnInputError(
            `no pending async tool call ${toolCallId}`,
        );
    }
    return tc;
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
