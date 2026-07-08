import type { ChildProcess } from "child_process";
import type { z } from "zod";
import type { ToolAttachment } from "@x/shared/dist/agent.js";
import type { JsonValue, ToolDescriptor } from "@x/shared/dist/turns.js";
import { execTool } from "../../application/lib/exec-tool.js";
import { BuiltinTools } from "../../application/lib/builtin-tools.js";
import {
    type IAbortRegistry,
    InMemoryAbortRegistry,
} from "../../runs/abort-registry.js";
import { TurnDependencyError } from "../api.js";
import type {
    IToolRegistry,
    RuntimeTool,
    SyncRuntimeTool,
    ToolExecutionContext,
} from "../tool-registry.js";
import { ASK_HUMAN_TOOL } from "./real-agent-resolver.js";

export interface RealToolRegistryDeps {
    execToolImpl?: typeof execTool;
    abortRegistry?: IAbortRegistry;
    builtins?: typeof BuiltinTools;
}

// Sync tools within a turn execute concurrently, so abort-registry state must
// be scoped per tool call: createForRun destroys any existing state under its
// key, and cleanup would otherwise tear down the force-kill scope of
// still-running siblings. Builtins address the registry with ctx.runId (the
// turn id, which keeps its meaning elsewhere), so this wrapper pins every
// operation to the call-scoped key regardless of the key the caller passes.
class CallScopedAbortRegistry implements IAbortRegistry {
    constructor(
        private readonly inner: IAbortRegistry,
        private readonly key: string,
    ) {}

    createForRun(): AbortSignal {
        return this.inner.createForRun(this.key);
    }

    registerProcess(_runId: string, process: ChildProcess): void {
        this.inner.registerProcess(this.key, process);
    }

    unregisterProcess(_runId: string, process: ChildProcess): void {
        this.inner.unregisterProcess(this.key, process);
    }

    abort(): void {
        this.inner.abort(this.key);
    }

    forceAbort(): void {
        this.inner.forceAbort(this.key);
    }

    isAborted(): boolean {
        return this.inner.isAborted(this.key);
    }

    cleanup(): void {
        this.inner.cleanup(this.key);
    }
}

// Bridges persisted tool descriptors to the existing dispatch: builtins via
// the BuiltinTools catalog, MCP tools via execTool's MCP path. toolId encodes
// the attachment: "builtin:<name>" or "mcp:<server>:<tool>". ask-human is the
// async human-dependent tool with no in-process executor.
export class RealToolRegistry implements IToolRegistry {
    private readonly execToolImpl: typeof execTool;
    private readonly abortRegistry: IAbortRegistry;
    private readonly builtins: typeof BuiltinTools;

    constructor(deps: RealToolRegistryDeps = {}) {
        this.execToolImpl = deps.execToolImpl ?? execTool;
        this.abortRegistry = deps.abortRegistry ?? new InMemoryAbortRegistry();
        this.builtins = deps.builtins ?? BuiltinTools;
    }

    async resolve(
        descriptor: z.infer<typeof ToolDescriptor>,
    ): Promise<RuntimeTool> {
        if (descriptor.toolId === `builtin:${ASK_HUMAN_TOOL}`) {
            return {
                descriptor: descriptor as { execution: "async" } & z.infer<
                    typeof ToolDescriptor
                >,
            };
        }
        if (descriptor.toolId.startsWith("builtin:")) {
            const name = descriptor.toolId.slice("builtin:".length);
            const builtin = this.builtins[name];
            if (!builtin?.execute) {
                throw new TurnDependencyError(
                    `no live builtin tool for ${descriptor.toolId}`,
                );
            }
            return this.syncTool(descriptor, { type: "builtin", name });
        }
        if (descriptor.toolId.startsWith("mcp:")) {
            const rest = descriptor.toolId.slice("mcp:".length);
            const separator = rest.indexOf(":");
            if (separator <= 0 || separator === rest.length - 1) {
                throw new TurnDependencyError(
                    `malformed mcp toolId: ${descriptor.toolId}`,
                );
            }
            return this.syncTool(descriptor, {
                type: "mcp",
                name: rest.slice(separator + 1),
                mcpServerName: rest.slice(0, separator),
                description: descriptor.description,
                inputSchema: descriptor.inputSchema,
            });
        }
        throw new TurnDependencyError(
            `unrecognized toolId scheme: ${descriptor.toolId}`,
        );
    }

    private syncTool(
        descriptor: z.infer<typeof ToolDescriptor>,
        attachment: z.infer<typeof ToolAttachment>,
    ): SyncRuntimeTool {
        return {
            descriptor: descriptor as { execution: "sync" } & z.infer<
                typeof ToolDescriptor
            >,
            execute: async (input, ctx: ToolExecutionContext) => {
                // AbortSignal is the primary kill path; the abort registry is
                // the secondary force-kill for spawned child processes,
                // bracketed and keyed per tool call (sync tools in one turn
                // run concurrently).
                const abortRegistry: IAbortRegistry = new CallScopedAbortRegistry(
                    this.abortRegistry,
                    `${ctx.turnId}:${ctx.toolCallId}`,
                );
                abortRegistry.createForRun(ctx.turnId);
                const onAbort = () => abortRegistry.abort(ctx.turnId);
                ctx.signal.addEventListener("abort", onAbort, { once: true });
                try {
                    const value = await this.execToolImpl(
                        attachment,
                        asArgs(input),
                        {
                            runId: ctx.turnId,
                            toolCallId: ctx.toolCallId,
                            signal: ctx.signal,
                            abortRegistry,
                            publish: async (event) => {
                                if (event.type === "tool-output-stream") {
                                    await ctx.reportProgress({
                                        kind: "tool-output",
                                        chunk: event.output,
                                    });
                                } else if (event.type === "code-run-event") {
                                    // The live per-event stream travels over the
                                    // ephemeral CodeRunFeed (never persisted) — but a
                                    // permission RESOLUTION is durably marked so an
                                    // answered ask never resurrects as a pending card
                                    // after a reload or session switch.
                                    if (event.event.type === "permission") {
                                        await ctx.reportProgress({
                                            kind: "code-run-permission-resolved",
                                        });
                                    }
                                } else if (event.type === "code-run-permission-request") {
                                    // Durable (not feed-ephemeral): the coding turn is
                                    // BLOCKED until the user answers via
                                    // codeRun:resolvePermission, so the ask must survive
                                    // session switches — dropping it would hang the turn
                                    // under policy 'ask' with no card to answer.
                                    await ctx.reportProgress({
                                        kind: "code-run-permission-request",
                                        requestId: event.requestId,
                                        ask: toJsonValue(event.ask),
                                    });
                                } else if (event.type === "code-run-events-batch") {
                                    // Settle-time durable record of the whole timeline —
                                    // what reloads replay instead of the live feed.
                                    await ctx.reportProgress({
                                        kind: "code-run-events",
                                        events: toJsonValue(event.events),
                                    });
                                }
                            },
                        },
                    );
                    return {
                        output: toJsonValue(value === undefined ? null : value),
                        isError: false,
                    };
                } finally {
                    ctx.signal.removeEventListener("abort", onAbort);
                    abortRegistry.cleanup(ctx.turnId);
                }
            },
        };
    }
}

function asArgs(input: unknown): Record<string, unknown> {
    return input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
}

function toJsonValue(value: unknown): JsonValue {
    try {
        const parsed: unknown = JSON.parse(JSON.stringify(value));
        return parsed === undefined ? null : (parsed as JsonValue);
    } catch {
        return String(value);
    }
}
