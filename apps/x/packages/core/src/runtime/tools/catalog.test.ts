import * as os from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeRunEvent } from "@x/shared/dist/code-mode.js";
import container from "../../di/container.js";
import { InMemoryAbortRegistry } from "../turns/abort-registry.js";
import { BuiltinTools, coalesceCodeRunEvents } from "./catalog.js";
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


// THE golden test for the tool-catalog split: catalog key order is the
// order tools are declared to the model, i.e. provider-payload bytes inside
// the cached prompt prefix. The split into domain modules must reproduce
// the historical order verbatim — do not alphabetize, do not regroup.
// (spawn-agent registers dynamically after the literal, hence last.)
// An intentional addition belongs at the position its domain dictates and
// updates this list in the same commit.
const HISTORICAL_KEY_ORDER = [
    "loadSkill",
    "file-getRoot",
    "file-exists",
    "file-stat",
    "file-list",
    "file-readText",
    "file-writeText",
    "file-editText",
    "file-mkdir",
    "file-rename",
    "file-copy",
    "file-remove",
    "file-glob",
    "file-grep",
    "parseFile",
    "LLMParse",
    "analyzeAgent",
    "addMcpServer",
    "listMcpServers",
    "listMcpTools",
    "executeMcpTool",
    "executeCommand",
    "code_agent_run",
    "load-browser-skill",
    "browser-control",
    "app-navigation",
    "web-search",
    "save-to-memory",
    "composio-list-toolkits",
    "composio-search-tools",
    "composio-execute-tool",
    "composio-connect-toolkit",
    "app-read-data",
    "app-set-data",
    "list-models",
    "fetch-url",
    "run-live-note-agent",
    "create-background-task",
    "patch-background-task",
    "run-background-task-agent",
    "launch-code-task",
    "notify-user",
    "generate-image",
    "spawn-agent",
];

describe("BuiltinTools catalog key order", () => {
    it("preserves the historical key order byte-for-byte", () => {
        expect(Object.keys(BuiltinTools)).toEqual(HISTORICAL_KEY_ORDER);
    });
});

describe("BuiltinTools permission audit", () => {
    // Pins the set of gated builtins so policy changes are always intentional:
    // adding a tool with anything other than "none" (or forgetting that a new
    // side-effecting tool should be gated) must show up in this diff. The
    // checker independently fails closed for undeclared tools.
    it("gates exactly the audited set of builtins", () => {
        const gated = Object.entries(BuiltinTools)
            .filter(([, tool]) => tool.permission !== "none")
            .map(([name, tool]) => [name, tool.permission]);
        expect(Object.fromEntries(gated)).toEqual({
            "file-readText": "file-boundary",
            "file-writeText": "file-boundary",
            "file-editText": "file-boundary",
            "file-list": "file-boundary",
            "file-glob": "file-boundary",
            "file-grep": "file-boundary",
            "file-exists": "file-boundary",
            "file-stat": "file-boundary",
            "file-copy": "file-boundary",
            "file-rename": "file-boundary",
            "file-remove": "file-boundary",
            "file-mkdir": "file-boundary",
            parseFile: "file-boundary",
            LLMParse: "file-boundary",
            executeCommand: "command-allowlist",
            addMcpServer: "prompt",
            executeMcpTool: "mcp-execute",
            "composio-execute-tool": "composio-execute",
            "generate-image": "file-boundary",
        });
    });
});
