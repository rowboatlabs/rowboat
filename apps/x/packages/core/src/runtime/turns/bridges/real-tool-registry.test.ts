import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ToolDescriptor } from "@x/shared/dist/turns.js";
import type { execTool } from "../../tools/exec-tool.js";
import type { BuiltinTools } from "../../tools/catalog.js";
import type { IAbortRegistry } from "../abort-registry.js";
import { TurnDependencyError } from "../api.js";
import type { SyncRuntimeTool, ToolExecutionContext } from "../tool-registry.js";
import { RealToolRegistry } from "./real-tool-registry.js";

type ExecCall = {
    attachment: Parameters<typeof execTool>[0];
    input: Record<string, unknown>;
    ctx: NonNullable<Parameters<typeof execTool>[2]>;
};

class FakeAbortRegistry implements IAbortRegistry {
    calls: string[] = [];
    createForRun(runId: string): AbortSignal {
        this.calls.push(`create:${runId}`);
        return new AbortController().signal;
    }
    registerProcess(runId: string): void {
        this.calls.push(`register:${runId}`);
    }
    unregisterProcess(): void {}
    abort(runId: string): void {
        this.calls.push(`abort:${runId}`);
    }
    forceAbort(): void {}
    isAborted(): boolean {
        return false;
    }
    cleanup(runId: string): void {
        this.calls.push(`cleanup:${runId}`);
    }
}

const fakeBuiltins = {
    echo: { description: "Echo", inputSchema: {}, execute: async () => null },
} as unknown as typeof BuiltinTools;

function descriptor(
    overrides: Partial<z.infer<typeof ToolDescriptor>> = {},
): z.infer<typeof ToolDescriptor> {
    return {
        toolId: "builtin:echo",
        name: "echo",
        description: "Echo",
        inputSchema: {},
        execution: "sync",
        requiresHuman: false,
        ...overrides,
    };
}

function makeCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext & {
    progress: unknown[];
} {
    const progress: unknown[] = [];
    return {
        turnId: "turn-1",
        toolCallId: "tc-1",
        signal: new AbortController().signal,
        reportProgress: async (p) => {
            progress.push(p);
        },
        progress,
        ...overrides,
    };
}

function makeRegistry(execImpl: (call: ExecCall) => Promise<unknown>) {
    const calls: ExecCall[] = [];
    const abortRegistry = new FakeAbortRegistry();
    const registry = new RealToolRegistry({
        execToolImpl: (async (attachment, input, ctx) => {
            const call = { attachment, input, ctx: ctx! };
            calls.push(call);
            return execImpl(call);
        }) as typeof execTool,
        abortRegistry,
        builtins: fakeBuiltins,
    });
    return { registry, calls, abortRegistry };
}

describe("error-envelope mapping", () => {
    async function resultFor(value: unknown) {
        const { registry } = makeRegistry(async () => value);
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        return tool.execute({}, makeCtx());
    }

    it("maps a bare error envelope to isError", async () => {
        const result = await resultFor({ error: "File not found: /x" });
        expect(result.isError).toBe(true);
        expect(result.output).toEqual({ error: "File not found: /x" });
    });

    it("maps success:false with a message to isError", async () => {
        const result = await resultFor({
            success: false,
            message: "Failed to analyze agent: boom",
        });
        expect(result.isError).toBe(true);
    });

    it("maps composio's successful:false envelope to isError", async () => {
        const result = await resultFor({
            successful: false,
            data: null,
            error: null,
        });
        expect(result.isError).toBe(true);
    });

    it("a non-zero exit code is a result, not a tool failure", async () => {
        const result = await resultFor({
            success: false,
            stdout: "",
            stderr: "no matches",
            exitCode: 1,
            command: "grep needle haystack",
        });
        expect(result.isError).toBe(false);
    });

    it("success shapes stay non-error, including composio passthrough", async () => {
        for (const value of [
            { ok: 1 },
            { success: true, analysis: "fine" },
            { successful: true, data: { id: 1 }, error: null },
            "plain text",
            ["a", "b"],
            null,
            { error: "" },
            { error: null },
        ]) {
            const result = await resultFor(value);
            expect(result.isError).toBe(false);
        }
    });
});

describe("RealToolRegistry", () => {
    it("executes builtins through execTool with a turn-scoped ToolContext", async () => {
        const { registry, calls, abortRegistry } = makeRegistry(async () => ({ ok: 1 }));
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        const ctx = makeCtx();
        const result = await tool.execute({ text: "hi" }, ctx);

        expect(result).toEqual({ output: { ok: 1 }, isError: false });
        expect(calls[0].attachment).toEqual({ type: "builtin", name: "echo" });
        expect(calls[0].input).toEqual({ text: "hi" });
        expect(calls[0].ctx).toMatchObject({ runId: "turn-1", toolCallId: "tc-1" });
        // Abort registry bracketed and keyed per tool call (sync tools in a
        // turn execute concurrently; a shared turn key would let one call
        // tear down its siblings' force-kill scope).
        expect(abortRegistry.calls).toEqual([
            "create:turn-1:tc-1",
            "cleanup:turn-1:tc-1",
        ]);
    });

    it("re-keys registry calls a tool makes with ctx.runId to the call scope", async () => {
        // Builtins address the abort registry with ctx.runId (the turn id).
        // The scoped wrapper must pin those to the per-call key, or a
        // process registered by one tool would land in no scope at all.
        const { registry, abortRegistry } = makeRegistry(async ({ ctx }) => {
            ctx.abortRegistry.registerProcess(ctx.runId, {} as never);
            return "ok";
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        await tool.execute({}, makeCtx());
        expect(abortRegistry.calls).toEqual([
            "create:turn-1:tc-1",
            "register:turn-1:tc-1",
            "cleanup:turn-1:tc-1",
        ]);
    });

    it("normalizes undefined results to null and serializes objects", async () => {
        const { registry } = makeRegistry(async () => undefined);
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        expect(await tool.execute({}, makeCtx())).toEqual({
            output: null,
            isError: false,
        });
    });

    it("forwards tool-output-stream publishes as progress", async () => {
        const { registry } = makeRegistry(async ({ ctx }) => {
            await ctx.publish({
                runId: "turn-1",
                type: "tool-output-stream",
                toolCallId: "tc-1",
                toolName: "echo",
                output: "chunk-1",
                subflow: [],
            });
            return "done";
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        const ctx = makeCtx();
        await tool.execute({}, ctx);
        expect(ctx.progress).toEqual([{ kind: "tool-output", chunk: "chunk-1" }]);
    });

    it("keeps code-run durability to permission asks/resolutions and the settle batch", async () => {
        const chunk = { type: "message", role: "agent", text: "hi" } as const;
        const resolution = {
            type: "permission",
            ask: { toolCallId: "x", title: "write file", isRead: false },
            decision: "allow_once",
            auto: false,
        } as const;
        const ask = { toolCallId: "x", title: "write file", isRead: false };
        const { registry } = makeRegistry(async ({ ctx }) => {
            // Chatty stream events are ephemeral (CodeRunFeed) — NOT progress.
            await ctx.publish({
                runId: "turn-1",
                type: "code-run-event",
                toolCallId: "tc-1",
                event: chunk,
                subflow: [],
            });
            await ctx.publish({
                runId: "turn-1",
                type: "code-run-permission-request",
                toolCallId: "tc-1",
                requestId: "cpr-1",
                ask,
                subflow: [],
            });
            // A permission resolution in the stream leaves a durable marker.
            await ctx.publish({
                runId: "turn-1",
                type: "code-run-event",
                toolCallId: "tc-1",
                event: resolution,
                subflow: [],
            });
            await ctx.publish({
                runId: "turn-1",
                type: "code-run-events-batch",
                toolCallId: "tc-1",
                events: [chunk, resolution],
                subflow: [],
            });
            return "done";
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        const ctx = makeCtx();
        await tool.execute({}, ctx);
        expect(ctx.progress).toEqual([
            { kind: "code-run-permission-request", requestId: "cpr-1", ask },
            { kind: "code-run-permission-resolved" },
            { kind: "code-run-events", events: [chunk, resolution] },
        ]);
    });

    it("wires the abort signal to the registry's force-kill path", async () => {
        const controller = new AbortController();
        const { registry, abortRegistry } = makeRegistry(async () => {
            controller.abort();
            return "late";
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        await tool.execute({}, makeCtx({ signal: controller.signal }));
        expect(abortRegistry.calls).toEqual([
            "create:turn-1:tc-1",
            "abort:turn-1:tc-1",
            "cleanup:turn-1:tc-1",
        ]);
    });

    it("lets tool errors propagate (the loop converts them to error results) and still cleans up", async () => {
        const { registry, abortRegistry } = makeRegistry(async () => {
            throw new Error("tool exploded");
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        await expect(tool.execute({}, makeCtx())).rejects.toThrowError("tool exploded");
        expect(abortRegistry.calls).toEqual([
            "create:turn-1:tc-1",
            "cleanup:turn-1:tc-1",
        ]);
    });

    it("resolves mcp descriptors into mcp attachments (server:tool split on first colon)", async () => {
        const { registry, calls } = makeRegistry(async () => "mcp result");
        const tool = (await registry.resolve(
            descriptor({
                toolId: "mcp:kb:search:advanced",
                name: "search:advanced",
                description: "Search KB",
                inputSchema: { type: "object" },
            }),
        )) as SyncRuntimeTool;
        await tool.execute({ q: "x" }, makeCtx());
        expect(calls[0].attachment).toEqual({
            type: "mcp",
            name: "search:advanced",
            mcpServerName: "kb",
            description: "Search KB",
            inputSchema: { type: "object" },
        });
    });

    it("resolves ask-human as an async tool with no executor", async () => {
        const { registry } = makeRegistry(async () => null);
        const tool = await registry.resolve(
            descriptor({
                toolId: "builtin:ask-human",
                name: "ask-human",
                execution: "async",
                requiresHuman: true,
            }),
        );
        expect("execute" in tool).toBe(false);
        expect(tool.descriptor.execution).toBe("async");
    });

    it("rejects unknown builtins and malformed toolIds as dependency errors", async () => {
        const { registry } = makeRegistry(async () => null);
        await expect(
            registry.resolve(descriptor({ toolId: "builtin:ghost", name: "ghost" })),
        ).rejects.toThrowError(TurnDependencyError);
        await expect(
            registry.resolve(descriptor({ toolId: "mcp:onlyserver" })),
        ).rejects.toThrowError(TurnDependencyError);
        await expect(
            registry.resolve(descriptor({ toolId: "weird:scheme" })),
        ).rejects.toThrowError(TurnDependencyError);
    });
});
