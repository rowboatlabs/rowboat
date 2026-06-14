import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import { ToolCallPart } from "@x/shared/dist/message.js";
import type { ToolRunContext } from "../agent-loop/tool-runner.js";
import type { TurnEvent } from "../agent-loop/types.js";
import type { ToolContext } from "../application/lib/exec-tool.js";
import { IAbortRegistry } from "../runs/abort-registry.js";
import { AgentTools } from "./agent-tools.js";
import { RealToolRunner } from "./real-tool-runner.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeAgent(tools: Record<string, z.infer<typeof ToolAttachment>>): z.infer<typeof Agent> {
    return { name: "test-agent", instructions: "", tools };
}

function agentToolsFor(tools: Record<string, z.infer<typeof ToolAttachment>>): AgentTools {
    return new AgentTools(async () => makeAgent(tools));
}

function toolCall(toolName: string, args: Record<string, unknown> = {}): z.infer<typeof ToolCallPart> {
    return { type: "tool-call", toolCallId: `tc-${toolName}`, toolName, arguments: args };
}

function makeCtx(): {
    ctx: ToolRunContext;
    emitted: TurnEvent[];
    controller: AbortController;
} {
    const controller = new AbortController();
    const emitted: TurnEvent[] = [];
    const ctx: ToolRunContext = {
        turnId: "turn-1",
        agentId: "test-agent",
        codeMode: null,
        signal: controller.signal,
        emit: (event) => emitted.push(event),
    };
    return { ctx, emitted, controller };
}

class FakeAbortRegistry implements IAbortRegistry {
    createdFor: string[] = [];
    aborted: string[] = [];
    cleaned: string[] = [];
    createForRun(runId: string): AbortSignal {
        this.createdFor.push(runId);
        return new AbortController().signal;
    }
    registerProcess(): void {}
    unregisterProcess(): void {}
    abort(runId: string): void {
        this.aborted.push(runId);
    }
    forceAbort(): void {}
    isAborted(): boolean {
        return false;
    }
    cleanup(runId: string): void {
        this.cleaned.push(runId);
    }
}

const builtin = (name: string): z.infer<typeof ToolAttachment> => ({ type: "builtin", name });
const mcp = (name: string, inputSchema: unknown): z.infer<typeof ToolAttachment> => ({
    type: "mcp",
    name,
    description: `mcp ${name}`,
    inputSchema,
    mcpServerName: "srv",
});

// ─── definitions ──────────────────────────────────────────────────────────────

describe("RealToolRunner.definitions", () => {
    it("maps builtin (zod→JSON Schema), MCP (pass-through), and ask-human", async () => {
        const schema = { type: "object", properties: { q: { type: "string" } } };
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({
                "file-exists": builtin("file-exists"),
                search: mcp("search", schema),
                "ask-human": builtin("ask-human"),
            }),
        });

        const defs = await runner.definitions("test-agent");
        const byName = new Map(defs.map((d) => [d.name, d]));

        expect(new Set(byName.keys())).toEqual(new Set(["file-exists", "search", "ask-human"]));
        // builtin converted to JSON Schema with a `path` property
        expect((byName.get("file-exists")!.inputSchema as { type?: string }).type).toBe("object");
        expect((byName.get("file-exists")!.inputSchema as { properties?: Record<string, unknown> }).properties)
            .toHaveProperty("path");
        // MCP schema passes through unchanged
        expect(byName.get("search")!.inputSchema).toBe(schema);
        // ask-human gets its synthesized schema
        expect((byName.get("ask-human")!.inputSchema as { required?: string[] }).required).toEqual(["question"]);
    });

    it("returns nothing for an agent-less turn and skips agent-as-tool attachments", async () => {
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ sub: { type: "agent", name: "sub" } }),
        });
        expect(await runner.definitions(null)).toEqual([]);
        expect(await runner.definitions("test-agent")).toEqual([]);
    });

    it("caches the agent config across calls (one load)", async () => {
        let loads = 0;
        const agentTools = new AgentTools(async () => {
            loads++;
            return makeAgent({ "file-exists": builtin("file-exists") });
        });
        const runner = new RealToolRunner({ agentTools });
        await runner.definitions("test-agent");
        await runner.definitions("test-agent");
        expect(loads).toBe(1);
    });
});

// ─── run ───────────────────────────────────────────────────────────────────

describe("RealToolRunner.run", () => {
    it("dispatches a real builtin (file-exists) against an absolute path", async () => {
        const dir = await mkdtemp(join(tmpdir(), "tool-runner-"));
        const file = join(dir, "present.txt");
        await writeFile(file, "hi");

        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ "file-exists": builtin("file-exists") }),
        });
        const { ctx } = makeCtx();

        const present = await runner.run(toolCall("file-exists", { path: file }), ctx);
        const absent = await runner.run(toolCall("file-exists", { path: join(dir, "nope.txt") }), ctx);

        expect(present).toMatchObject({ type: "result", value: { exists: true } });
        expect(absent).toMatchObject({ type: "result", value: { exists: false } });
    });

    it("returns pending for ask-human without executing anything", async () => {
        let called = false;
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ "ask-human": builtin("ask-human") }),
            execTool: async () => {
                called = true;
                return null;
            },
        });
        const { ctx } = makeCtx();
        expect(await runner.run(toolCall("ask-human", { question: "ok?" }), ctx)).toEqual({ type: "pending" });
        expect(called).toBe(false);
    });

    it("returns an error outcome for a tool the agent does not have", async () => {
        const runner = new RealToolRunner({ agentTools: agentToolsFor({}) });
        const { ctx } = makeCtx();
        expect(await runner.run(toolCall("nonexistent"), ctx)).toEqual({
            type: "error",
            value: "Unknown tool: nonexistent",
        });
    });

    it("dispatches MCP calls through execTool with the attachment and args", async () => {
        const seen: { attachment: unknown; args: unknown }[] = [];
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ search: mcp("search", {}) }),
            execTool: async (attachment, args) => {
                seen.push({ attachment, args });
                return { hits: 3 };
            },
        });
        const { ctx } = makeCtx();
        const out = await runner.run(toolCall("search", { q: "term" }), ctx);
        expect(out).toEqual({ type: "result", value: { hits: 3 } });
        expect(seen).toHaveLength(1);
        expect(seen[0].attachment).toMatchObject({ type: "mcp", name: "search" });
        expect(seen[0].args).toEqual({ q: "term" });
    });

    it("lets a thrown tool error propagate (the loop records it, not the bridge)", async () => {
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ "file-exists": builtin("file-exists") }),
            execTool: async () => {
                throw new Error("ECONNRESET");
            },
        });
        const { ctx } = makeCtx();
        await expect(runner.run(toolCall("file-exists"), ctx)).rejects.toThrow("ECONNRESET");
    });

    it("translates a tool-output-stream publish into a tool-output emit", async () => {
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ executeCommand: builtin("executeCommand") }),
            execTool: async (_attachment, _args, toolCtx?: ToolContext) => {
                await toolCtx!.publish({
                    runId: toolCtx!.runId,
                    type: "tool-output-stream",
                    toolCallId: toolCtx!.toolCallId,
                    toolName: "executeCommand",
                    output: "line of stdout",
                    subflow: [],
                });
                return { ok: true };
            },
        });
        const { ctx, emitted } = makeCtx();
        await runner.run(toolCall("executeCommand"), ctx);
        expect(emitted).toEqual([
            { type: "tool-output", toolCallId: "tc-executeCommand", chunk: "line of stdout" },
        ]);
    });

    it("brackets the run with the abort registry and forwards aborts to it", async () => {
        const registry = new FakeAbortRegistry();
        const { ctx, controller } = makeCtx();
        const runner = new RealToolRunner({
            agentTools: agentToolsFor({ executeCommand: builtin("executeCommand") }),
            abortRegistry: registry,
            // The turn is stopped while the tool is in flight.
            execTool: async () => {
                controller.abort();
                return null;
            },
        });
        await runner.run(toolCall("executeCommand"), ctx);

        expect(registry.createdFor).toEqual(["turn-1"]);
        expect(registry.aborted).toEqual(["turn-1"]); // signal abort → registry.abort
        expect(registry.cleaned).toEqual(["turn-1"]);
    });
});
