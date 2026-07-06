import * as os from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeRunEvent } from "@x/shared/dist/code-mode.js";
import container from "../../di/container.js";
import { InMemoryAbortRegistry } from "../../runs/abort-registry.js";
import { BuiltinTools, coalesceCodeRunEvents } from "./builtin-tools.js";
import type { ToolContext } from "./exec-tool.js";

// A real directory: code_agent_run validates the cwd exists before spawning.
const CWD = os.tmpdir();

function context(signal: AbortSignal, published: unknown[] = []): ToolContext {
    return {
        runId: "turn-1",
        toolCallId: "tool-1",
        signal,
        abortRegistry: new InMemoryAbortRegistry(),
        publish: async (event) => {
            published.push(event);
        },
        codePolicy: "ask",
    };
}

function mockCodeServices(
    runPrompt: (opts: { onEvent: (event: CodeRunEvent) => void }) => Promise<unknown>,
): { feedEvents: unknown[] } {
    const feedEvents: unknown[] = [];
    vi.spyOn(container, "resolve").mockImplementation(((name: string) => {
        if (name === "codeModeManager") return { runPrompt };
        if (name === "codePermissionRegistry") {
            return { cancelRun: vi.fn(), request: vi.fn() };
        }
        if (name === "codeRunFeed") {
            return { broadcast: (event: unknown) => feedEvents.push(event) };
        }
        throw new Error(`Unexpected dependency: ${name}`);
    }) as typeof container.resolve);
    return { feedEvents };
}

describe("code_agent_run", () => {
    afterEach(() => vi.restoreAllMocks());

    it("throws genuine coding-agent failures for the runtime to mark as errors", async () => {
        mockCodeServices(async () => {
            throw new Error("spawn Electron ENOENT");
        });

        await expect(BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: CWD, prompt: "Fix it" },
            context(new AbortController().signal),
        )).rejects.toThrow("Coding agent failed: spawn Electron ENOENT");
    });

    it("rejects a working directory that does not exist with a clear error", async () => {
        mockCodeServices(async () => {
            throw new Error("unreachable");
        });

        await expect(BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: "/nonexistent-dir-for-test", prompt: "Fix it" },
            context(new AbortController().signal),
        )).rejects.toThrow("working directory does not exist");
    });

    it("returns an ordinary cancellation result when the turn was aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        mockCodeServices(async () => {
            throw new Error("cancelled");
        });

        await expect(BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: CWD, prompt: "Fix it" },
            context(controller.signal),
        )).resolves.toMatchObject({ success: false, stopReason: "cancelled" });
    });

    it("broadcasts events on the feed live and publishes ONE coalesced durable batch", async () => {
        const { feedEvents } = mockCodeServices(async ({ onEvent }) => {
            onEvent({ type: "message", role: "agent", text: "hel" });
            onEvent({ type: "message", role: "agent", text: "lo" });
            onEvent({ type: "tool_call", id: "x", title: "write file" });
            return { stopReason: "end_turn", sessionId: "s1" };
        });
        const published: unknown[] = [];

        const result = await BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: CWD, prompt: "Fix it" },
            context(new AbortController().signal, published),
        );

        expect(result).toMatchObject({ success: true, summary: "hello" });
        // Live side-channel: every event, verbatim, keyed by the tool call.
        expect(feedEvents).toHaveLength(3);
        expect(feedEvents[0]).toMatchObject({
            toolCallId: "tool-1",
            event: { type: "message", text: "hel" },
        });
        // Durable: per-event publishes for the legacy bus + exactly one batch,
        // with consecutive same-role message chunks coalesced.
        const batches = published.filter(
            (e) => (e as { type?: string }).type === "code-run-events-batch",
        );
        expect(batches).toHaveLength(1);
        expect((batches[0] as { events: CodeRunEvent[] }).events).toEqual([
            { type: "message", role: "agent", text: "hello" },
            { type: "tool_call", id: "x", title: "write file" },
        ]);
    });

    it("publishes the partial batch even when the run fails", async () => {
        mockCodeServices(async ({ onEvent }) => {
            onEvent({ type: "message", role: "agent", text: "started..." });
            throw new Error("engine crashed");
        });
        const published: unknown[] = [];

        await expect(BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: CWD, prompt: "Fix it" },
            context(new AbortController().signal, published),
        )).rejects.toThrow("Coding agent failed");
        const batches = published.filter(
            (e) => (e as { type?: string }).type === "code-run-events-batch",
        );
        expect(batches).toHaveLength(1);
    });
});

describe("coalesceCodeRunEvents", () => {
    it("merges consecutive same-role message chunks and keeps everything else in order", () => {
        const events: CodeRunEvent[] = [
            { type: "message", role: "agent", text: "a" },
            { type: "message", role: "agent", text: "b" },
            { type: "tool_call", id: "t1", title: "run" },
            { type: "message", role: "agent", text: "c" },
            { type: "message", role: "user", text: "d" },
            { type: "message", role: "user", text: "e" },
        ];
        expect(coalesceCodeRunEvents(events)).toEqual([
            { type: "message", role: "agent", text: "ab" },
            { type: "tool_call", id: "t1", title: "run" },
            { type: "message", role: "agent", text: "c" },
            { type: "message", role: "user", text: "de" },
        ]);
    });

    it("returns an empty list unchanged", () => {
        expect(coalesceCodeRunEvents([])).toEqual([]);
    });
});
