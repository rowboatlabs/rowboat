import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ToolDescriptor } from "@x/shared/dist/turns.js";
import type { execTool } from "../../application/lib/exec-tool.js";
import type { BuiltinTools } from "../../application/lib/builtin-tools.js";
import type { IAbortRegistry } from "../../runs/abort-registry.js";
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
    registerProcess(): void {}
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
        // Abort registry bracketed per call.
        expect(abortRegistry.calls).toEqual(["create:turn-1", "cleanup:turn-1"]);
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

    it("wires the abort signal to the registry's force-kill path", async () => {
        const controller = new AbortController();
        const { registry, abortRegistry } = makeRegistry(async () => {
            controller.abort();
            return "late";
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        await tool.execute({}, makeCtx({ signal: controller.signal }));
        expect(abortRegistry.calls).toEqual([
            "create:turn-1",
            "abort:turn-1",
            "cleanup:turn-1",
        ]);
    });

    it("lets tool errors propagate (the loop converts them to error results) and still cleans up", async () => {
        const { registry, abortRegistry } = makeRegistry(async () => {
            throw new Error("tool exploded");
        });
        const tool = (await registry.resolve(descriptor())) as SyncRuntimeTool;
        await expect(tool.execute({}, makeCtx())).rejects.toThrowError("tool exploded");
        expect(abortRegistry.calls).toEqual(["create:turn-1", "cleanup:turn-1"]);
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
