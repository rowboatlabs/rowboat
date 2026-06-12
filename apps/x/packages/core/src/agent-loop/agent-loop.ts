import crypto from "node:crypto";
import { z } from "zod";
import { ToolCallPart, ToolMessage } from "@x/shared/dist/message.js";
import { EventStream } from "./event-stream.js";
import type { ModelAdapter } from "./model-adapter.js";
import type { PermissionGate } from "./permission-gate.js";
import type { ToolRunner, ToolRunResult } from "./tool-runner.js";
import type { TurnStore } from "./turn-store.js";
import {
    AgentLoopInput,
    AgentLoopTurn,
    deriveToolCallState,
    unresolvedToolCalls,
    type TurnEvent,
} from "./types.js";

const DEFAULT_MAX_ITERATIONS = 50;

export type TurnHandle = {
    id: string;
    events: AsyncIterable<TurnEvent>;
    result: Promise<z.infer<typeof AgentLoopTurn>>;
};

export interface AgentLoop {
    createTurn(input: z.infer<typeof AgentLoopInput>): TurnHandle;
    respondToPermission(
        turnId: string,
        toolCallId: string,
        decision: "granted" | "denied",
        reason?: string,
    ): TurnHandle;
    setToolResult(turnId: string, r: { toolCallId: string; result: unknown }): TurnHandle;
    resumeTurn(turnId: string): TurnHandle;
    getTurn(turnId: string): Promise<z.infer<typeof AgentLoopTurn>>;
    stopTurn(turnId: string): Promise<z.infer<typeof AgentLoopTurn>>;
}

// Serializes async work per key. Unlike the try-lock in runs/lock.ts, callers
// queue instead of failing — public mutations on the same turn run in order.
class TurnMutex {
    private chains = new Map<string, Promise<unknown>>();

    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.chains.get(key) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        const tail: Promise<void> = next
            .catch(() => undefined)
            .then(() => {
                // Drop the entry once the chain is fully drained.
                if (this.chains.get(key) === tail) this.chains.delete(key);
            });
        this.chains.set(key, tail);
        return next;
    }
}

function nowIso(): string {
    return new Date().toISOString();
}

function stringifyToolResult(value: unknown): string {
    if (typeof value === "string") return value;
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
}

function toolMessage(
    call: z.infer<typeof ToolCallPart>,
    content: string,
): z.infer<typeof ToolMessage> {
    return {
        role: "tool",
        content,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
    };
}

export class AgentLoopImpl implements AgentLoop {
    private store: TurnStore;
    private modelAdapter: ModelAdapter;
    private toolRunner: ToolRunner;
    private permissionGate: PermissionGate;
    private maxIterations: number;
    private mutex = new TurnMutex();
    // All not-yet-finished entries per turn (running AND queued behind the
    // mutex) — registered synchronously so stopTurn can never race past one.
    private active = new Map<string, Set<AbortController>>();

    constructor(deps: {
        store: TurnStore;
        modelAdapter: ModelAdapter;
        toolRunner: ToolRunner;
        permissionGate: PermissionGate;
        maxIterations?: number;
    }) {
        this.store = deps.store;
        this.modelAdapter = deps.modelAdapter;
        this.toolRunner = deps.toolRunner;
        this.permissionGate = deps.permissionGate;
        this.maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    }

    createTurn(input: z.infer<typeof AgentLoopInput>): TurnHandle {
        const turnId = crypto.randomUUID();
        return this.enter(turnId, async () => {
            const parsed = AgentLoopInput.parse(input);
            const now = nowIso();
            await this.store.create({
                id: turnId,
                agentId: parsed.agentId ?? null,
                provider: parsed.provider ?? null,
                model: parsed.model ?? null,
                permissionMode: parsed.permissionMode ?? "manual",
                messages: parsed.messages,
                permissionRequests: [],
                permissionDecisions: [],
                startedTools: [],
                dispatchedTools: [],
                error: null,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
            });
        });
    }

    respondToPermission(
        turnId: string,
        toolCallId: string,
        decision: "granted" | "denied",
        reason?: string,
    ): TurnHandle {
        return this.enter(turnId, async () => {
            const turn = await this.mustGet(turnId);
            this.assertMutable(turn);
            const state = deriveToolCallState(turn, toolCallId);
            if (state !== "awaiting-user" && state !== "needs-classifier") {
                throw new Error(`No open permission request for tool call: ${toolCallId}`);
            }
            turn.permissionDecisions.push({
                toolCallId,
                decidedBy: "user",
                decision,
                reason: reason ?? null,
                decidedAt: nowIso(),
            });
            if (decision === "denied") {
                // Denial resolves the call: decision + denial ToolMessage in one write.
                const call = this.mustFindToolCall(turn, toolCallId);
                turn.messages.push(toolMessage(
                    call,
                    `Permission denied by the user${reason ? `: ${reason}` : ""}`,
                ));
            }
            await this.persist(turn);
        });
    }

    setToolResult(turnId: string, r: { toolCallId: string; result: unknown }): TurnHandle {
        return this.enter(turnId, async () => {
            const turn = await this.mustGet(turnId);
            this.assertMutable(turn);
            const state = deriveToolCallState(turn, r.toolCallId);
            if (state !== "dispatched") {
                throw new Error(`Tool call is not awaiting an external result: ${r.toolCallId}`);
            }
            const call = this.mustFindToolCall(turn, r.toolCallId);
            turn.messages.push(toolMessage(call, stringifyToolResult(r.result)));
            await this.persist(turn);
        });
    }

    resumeTurn(turnId: string): TurnHandle {
        return this.enter(turnId, async () => {
            await this.mustGet(turnId);
        });
    }

    async getTurn(turnId: string): Promise<z.infer<typeof AgentLoopTurn>> {
        return this.mustGet(turnId);
    }

    async stopTurn(turnId: string): Promise<z.infer<typeof AgentLoopTurn>> {
        for (const controller of this.active.get(turnId) ?? []) {
            controller.abort();
        }
        // Queue behind the in-flight advance so it has fully wound down.
        return this.mutex.run(turnId, () => this.mustGet(turnId));
    }

    // ── internals ───────────────────────────────────────────────────────────

    // Every loop-entering method: persist its fact (prepare), then re-enter the
    // advance() reducer, all under the per-turn mutex. The handle's result
    // resolves when the turn reaches a rest state.
    private enter(turnId: string, prepare: () => Promise<void>): TurnHandle {
        const stream = new EventStream<TurnEvent, z.infer<typeof AgentLoopTurn>>();
        const controller = new AbortController();
        const controllers = this.active.get(turnId) ?? new Set();
        controllers.add(controller);
        this.active.set(turnId, controllers);
        void this.mutex.run(turnId, async () => {
            try {
                // prepare() persists the entry's fact even if already stopped;
                // a stop aborts execution, never the recording of facts.
                await prepare();
                await this.advance(turnId, stream, controller.signal);
                stream.end(await this.mustGet(turnId));
            } catch (error) {
                stream.fail(error);
            } finally {
                controllers.delete(controller);
                if (controllers.size === 0) this.active.delete(turnId);
            }
        });
        return { id: turnId, events: stream, result: stream.result };
    }

    // The reducer. Driven purely by persisted facts: re-reads the turn from the
    // store at the top of every iteration; no in-memory state is carried over.
    // Crash recovery is free — this IS the resume function.
    private async advance(
        turnId: string,
        stream: EventStream<TurnEvent, z.infer<typeof AgentLoopTurn>>,
        signal: AbortSignal,
    ): Promise<void> {
        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            if (signal.aborted) return;
            const turn = await this.mustGet(turnId);

            // 1. terminal states
            if (turn.error !== null || turn.completedAt !== null) return;

            const unresolved = unresolvedToolCalls(turn);
            const stateOf = new Map(unresolved.map((call) => [
                call.toolCallId,
                deriveToolCallState(turn, call.toolCallId),
            ]));

            // 2. waiting → stop. The "never call the model while anything is
            // waiting" invariant lives here and only here.
            if ([...stateOf.values()].some((s) => s === "awaiting-user" || s === "dispatched")) {
                return;
            }

            try {
                // 3. classifier (auto mode): classify all, persist in one write
                const needsClassifier = unresolved.filter(
                    (call) => stateOf.get(call.toolCallId) === "needs-classifier",
                );
                if (needsClassifier.length > 0) {
                    for (const call of needsClassifier) {
                        const request = turn.permissionRequests
                            .find((r) => r.toolCallId === call.toolCallId)?.request;
                        const verdict = await this.permissionGate.classify(call, request);
                        turn.permissionDecisions.push({
                            toolCallId: call.toolCallId,
                            decidedBy: "classifier",
                            decision: verdict.decision,
                            reason: verdict.reason,
                            decidedAt: nowIso(),
                        });
                        if (verdict.decision === "denied") {
                            turn.messages.push(toolMessage(
                                call,
                                `Permission denied by the auto-permission classifier: ${verdict.reason}`,
                            ));
                        }
                    }
                    await this.persist(turn);
                    continue;
                }

                // 4. permission-not-yet-evaluated calls: batch-evaluate ALL of
                // them and append all requests in ONE write — the user sees one
                // approval moment, not N serial prompts.
                const unevaluated = unresolved.filter(
                    (call) => stateOf.get(call.toolCallId) === "unevaluated",
                );
                const executable = unresolved.filter(
                    (call) => stateOf.get(call.toolCallId) === "cleared",
                );
                if (unevaluated.length > 0) {
                    const requested: string[] = [];
                    for (const call of unevaluated) {
                        const check = await this.permissionGate.check(call);
                        if (check.required) {
                            turn.permissionRequests.push({
                                toolCallId: call.toolCallId,
                                request: check.request,
                                requestedAt: nowIso(),
                            });
                            requested.push(call.toolCallId);
                        } else {
                            executable.push(call);
                        }
                    }
                    if (requested.length > 0) {
                        await this.persist(turn);
                        for (const toolCallId of requested) {
                            stream.push({ type: "permission-requested", toolCallId });
                        }
                        continue; // re-derive: waiting (manual) or classifier (auto)
                    }
                }

                // 5. interrupted calls (started, never resolved nor dispatched):
                // never silently re-run a started tool — tell the model instead.
                const interrupted = unresolved.filter(
                    (call) => stateOf.get(call.toolCallId) === "interrupted",
                );
                if (interrupted.length > 0) {
                    for (const call of interrupted) {
                        turn.messages.push(toolMessage(
                            call,
                            "Tool execution was interrupted before completing. It may or may not have taken effect; do not assume it ran.",
                        ));
                    }
                    await this.persist(turn);
                    continue;
                }

                // 6. execute cleared calls
                if (executable.length > 0) {
                    for (const call of executable) {
                        signal.throwIfAborted();
                        // Record the start fact BEFORE side effects — this is what
                        // makes resume side-effect-safe.
                        turn.startedTools.push({
                            toolCallId: call.toolCallId,
                            startedAt: nowIso(),
                        });
                        await this.persist(turn);
                        stream.push({ type: "tool-execution-start", toolCallId: call.toolCallId });

                        // Tool failures are conversational: a throwing runner
                        // becomes an error ToolMessage the model can react to,
                        // never a terminal turn error. Aborts still propagate.
                        const outcome = await this.toolRunner
                            .run(call, { turnId, signal })
                            .catch((error: unknown): ToolRunResult => {
                                signal.throwIfAborted();
                                return {
                                    type: "error",
                                    value: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                                };
                            });
                        if (outcome.type === "pending") {
                            turn.dispatchedTools.push({
                                toolCallId: call.toolCallId,
                                dispatchedAt: nowIso(),
                            });
                        } else {
                            turn.messages.push(toolMessage(call, stringifyToolResult(outcome.value)));
                        }
                        await this.persist(turn);
                        if (outcome.type !== "pending") {
                            stream.push({ type: "tool-result", toolCallId: call.toolCallId });
                        }
                    }
                    continue;
                }

                // 7. nothing unresolved + complete assistant message last → done
                const last = turn.messages[turn.messages.length - 1];
                if (last && last.role === "assistant") {
                    turn.completedAt = nowIso();
                    await this.persist(turn);
                    return;
                }

                // 8. model call: accumulate in memory, commit only the complete
                // AssistantMessage. Deltas flow to the handle, never to disk.
                // The stream's result promise is the single source of failure:
                // it rejects on model error AND on abort, and the catch below
                // tells those apart via signal.aborted.
                const modelStream = this.modelAdapter.stream({
                    provider: turn.provider,
                    model: turn.model,
                    messages: turn.messages,
                    tools: this.toolRunner.definitions(),
                    signal,
                });
                for await (const event of modelStream) {
                    stream.push(event);
                }
                const assistantMessage = await modelStream.result;
                turn.messages.push(assistantMessage);
                await this.persist(turn);
            } catch (error) {
                if (signal.aborted) return; // stopped: turn stays as persisted (idle)
                await this.setTurnError(turnId, error);
                return;
            }
        }

        // 9. iteration cap exceeded
        await this.setTurnError(turnId, new Error(
            `Agent loop exceeded ${this.maxIterations} iterations`,
        ));
    }

    private async setTurnError(turnId: string, error: unknown): Promise<void> {
        const turn = await this.mustGet(turnId);
        turn.error = {
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.cause !== undefined
                ? { details: error.cause }
                : {}),
            at: nowIso(),
        };
        await this.persist(turn);
    }

    private async persist(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        turn.updatedAt = nowIso();
        await this.store.update(turn);
    }

    private async mustGet(turnId: string): Promise<z.infer<typeof AgentLoopTurn>> {
        const turn = await this.store.get(turnId);
        if (!turn) throw new Error(`Turn not found: ${turnId}`);
        return turn;
    }

    private assertMutable(turn: z.infer<typeof AgentLoopTurn>): void {
        if (turn.error !== null) {
            throw new Error(`Turn has a terminal error: ${turn.id}`);
        }
        if (turn.completedAt !== null) {
            throw new Error(`Turn is already completed: ${turn.id}`);
        }
    }

    private mustFindToolCall(
        turn: z.infer<typeof AgentLoopTurn>,
        toolCallId: string,
    ): z.infer<typeof ToolCallPart> {
        for (const msg of turn.messages) {
            if (msg.role !== "assistant" || typeof msg.content === "string") continue;
            for (const part of msg.content) {
                if (part.type === "tool-call" && part.toolCallId === toolCallId) return part;
            }
        }
        throw new Error(`Tool call not found in transcript: ${toolCallId}`);
    }
}
