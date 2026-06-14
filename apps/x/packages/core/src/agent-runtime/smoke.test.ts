import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import { AssistantMessage, ToolCallPart } from "@x/shared/dist/message.js";

// End-to-end smoke test: REAL SQLite stores + REAL RealToolRunner (real
// execTool + real builtin) + REAL RealPermissionGate, driven by a FAKE model
// adapter, proving the bridges compose into a working session round-trip.

let tmpDir: string;
let workspaceDir: string;
let storageModule: typeof import("../storage/index.js") | null = null;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-agent-runtime-smoke-"));
    workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    process.env.ROWBOAT_WORKDIR = workspaceDir;
    vi.resetModules();
    // config.ts kicks off knowledge-repo init as an import side effect; mock it
    // out so the test doesn't touch git (same pattern as the store tests).
    vi.doMock("../knowledge/version_history.js", () => ({
        initRepo: vi.fn(async () => undefined),
    }));
    vi.doMock("../knowledge/deprecate_today_note.js", () => ({
        deprecateTodayNote: vi.fn(async () => undefined),
    }));
});

afterEach(async () => {
    if (storageModule) {
        await storageModule.shutdownStorage().catch(() => undefined);
        storageModule = null;
    }
    delete process.env.ROWBOAT_WORKDIR;
    vi.doUnmock("../knowledge/version_history.js");
    vi.doUnmock("../knowledge/deprecate_today_note.js");
    vi.resetModules();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

const TEST_AGENT: z.infer<typeof Agent> = {
    name: "smoke-agent",
    instructions: "",
    tools: { "file-exists": { type: "builtin", name: "file-exists" } satisfies z.infer<typeof ToolAttachment> },
};

function toolCallMessage(toolCallId: string, args: Record<string, unknown>): z.infer<typeof AssistantMessage> {
    const part: z.infer<typeof ToolCallPart> = { type: "tool-call", toolCallId, toolName: "file-exists", arguments: args };
    return { role: "assistant", content: [part] };
}

describe("agent runtime (smoke)", () => {
    it("runs a session turn that calls a real builtin and completes, persisted in SQLite", async () => {
        const storage = await import("../storage/index.js");
        await storage.initStorage();
        storageModule = storage;
        const db = storage.getDb();

        const { SqliteTurnStore } = await import("../agent-loop/sqlite-turn-store.js");
        const { AgentLoopImpl } = await import("../agent-loop/agent-loop.js");
        const { EventStream } = await import("../agent-loop/event-stream.js");
        const { SqliteSessionStore } = await import("../sessions/sqlite-session-store.js");
        const { SessionsImpl } = await import("../sessions/sessions.js");
        const { AgentTools } = await import("./agent-tools.js");
        const { RealToolRunner } = await import("./real-tool-runner.js");
        const { RealPermissionGate } = await import("./real-permission-gate.js");
        const { TurnEventBus } = await import("./turn-event-bus.js");

        // A real file inside the workspace → file-exists needs no permission.
        const probe = path.join(workspaceDir, "probe.txt");
        await fs.writeFile(probe, "hi");

        // Fake model: first step calls file-exists, second step ends the turn.
        const steps: z.infer<typeof AssistantMessage>[] = [
            toolCallMessage("tc1", { path: probe }),
            { role: "assistant", content: "done" },
        ];
        const modelAdapter = {
            stream(): InstanceType<typeof EventStream> {
                const out = new EventStream();
                const message = steps.shift()!;
                void (async () => {
                    await Promise.resolve();
                    if (typeof message.content !== "string") {
                        for (const part of message.content) {
                            if (part.type === "tool-call") out.push({ type: "tool-call", toolCall: part });
                        }
                    }
                    out.push({ type: "finish", message });
                    out.end({ message, usage: null });
                })();
                return out;
            },
        };

        const agentTools = new AgentTools(async () => TEST_AGENT);
        const turnStore = new SqliteTurnStore(db);
        const bus = new TurnEventBus();
        const busEvents: { kind: string; turnId: string }[] = [];
        bus.subscribe((e) => busEvents.push({ kind: e.kind, turnId: e.turnId }));
        const agentLoop = new AgentLoopImpl({
            store: turnStore,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            modelAdapter: modelAdapter as any,
            toolRunner: new RealToolRunner({ agentTools }),
            permissionGate: new RealPermissionGate({ agentTools }),
            observer: bus,
        });
        const sessions = new SessionsImpl({
            sessionStore: new SqliteSessionStore(db),
            turnStore,
            agentLoop,
        });

        const session = await sessions.createSession({ agentId: "smoke-agent" });
        const turn = await (await sessions.sendMessage(session.id, [{ role: "user", content: "is it there?" }])).result;

        // The turn completed, the real builtin ran, and its result is recorded.
        const { deriveTurnStatus } = await import("../agent-loop/types.js");
        expect(deriveTurnStatus(turn)).toBe("completed");
        expect(turn.sessionSeq).toBe(1);
        const toolResult = turn.messages.find((m) => m.role === "tool");
        expect(toolResult).toBeDefined();
        expect(String((toolResult as { content: string }).content)).toContain('"exists":true');

        // It is durably persisted: a fresh read of the session sees the turn.
        const reread = await sessions.listTurns(session.id);
        expect(reread).toHaveLength(1);
        expect(reread[0].id).toBe(turn.id);
        expect(deriveTurnStatus(reread[0])).toBe("completed");

        // The bus saw live events and state snapshots for this turn.
        expect(busEvents.some((e) => e.kind === "event" && e.turnId === turn.id)).toBe(true);
        expect(busEvents.some((e) => e.kind === "state" && e.turnId === turn.id)).toBe(true);
    });
});
