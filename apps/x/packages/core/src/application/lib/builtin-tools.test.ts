import { afterEach, describe, expect, it, vi } from "vitest";
import container from "../../di/container.js";
import { InMemoryAbortRegistry } from "../../runs/abort-registry.js";
import { BuiltinTools } from "./builtin-tools.js";
import type { ToolContext } from "./exec-tool.js";

function context(signal: AbortSignal): ToolContext {
    return {
        runId: "turn-1",
        toolCallId: "tool-1",
        signal,
        abortRegistry: new InMemoryAbortRegistry(),
        publish: async () => {},
        codePolicy: "ask",
    };
}

function mockCodeServices(runPrompt: () => Promise<never>): void {
    vi.spyOn(container, "resolve").mockImplementation(((name: string) => {
        if (name === "codeModeManager") return { runPrompt };
        if (name === "codePermissionRegistry") {
            return { cancelRun: vi.fn(), request: vi.fn() };
        }
        throw new Error(`Unexpected dependency: ${name}`);
    }) as typeof container.resolve);
}

describe("code_agent_run", () => {
    afterEach(() => vi.restoreAllMocks());

    it("throws genuine coding-agent failures for the runtime to mark as errors", async () => {
        mockCodeServices(async () => {
            throw new Error("spawn Electron ENOENT");
        });

        await expect(BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: "/repo", prompt: "Fix it" },
            context(new AbortController().signal),
        )).rejects.toThrow("Coding agent failed: spawn Electron ENOENT");
    });

    it("returns an ordinary cancellation result when the turn was aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        mockCodeServices(async () => {
            throw new Error("cancelled");
        });

        await expect(BuiltinTools.code_agent_run.execute(
            { agent: "codex", cwd: "/repo", prompt: "Fix it" },
            context(controller.signal),
        )).resolves.toMatchObject({ success: false, stopReason: "cancelled" });
    });
});
