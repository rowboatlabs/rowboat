import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentLoopTurn } from "./types.js";

let tmpDir: string;
let workspaceDir: string;
let storageModule: typeof import("../storage/index.js") | null = null;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-agent-loop-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    process.env.ROWBOAT_WORKDIR = workspaceDir;
    vi.resetModules();
    // config.ts kicks off knowledge-repo init as an import side effect; mock it
    // out so tests don't touch git (same pattern as storage/storage.test.ts).
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

async function loadStore() {
    storageModule = await import("../storage/index.js");
    await storageModule.initStorage();
    const { SqliteTurnStore } = await import("./sqlite-turn-store.js");
    return { store: new SqliteTurnStore(storageModule.getDb()), db: storageModule.getDb() };
}

function sampleTurn(id: string): z.infer<typeof AgentLoopTurn> {
    return {
        id,
        agentId: "agent-1",
        provider: "openai",
        model: "gpt-x",
        permissionMode: "auto",
        messages: [
            { role: "user", content: "hello" },
            {
                role: "assistant",
                content: [
                    { type: "text", text: "let me check" },
                    { type: "tool-call", toolCallId: "tc1", toolName: "read", arguments: { path: "/a" } },
                ],
            },
            { role: "tool", content: "file contents", toolCallId: "tc1", toolName: "read" },
        ],
        permissionRequests: [
            { toolCallId: "tc1", request: { fileAccess: ["/a"] }, requestedAt: "2026-06-12T00:00:00Z" },
        ],
        permissionDecisions: [
            {
                toolCallId: "tc1",
                decidedBy: "classifier",
                decision: "granted",
                reason: "read-only access",
                decidedAt: "2026-06-12T00:00:01Z",
            },
        ],
        startedTools: [{ toolCallId: "tc1", startedAt: "2026-06-12T00:00:02Z" }],
        dispatchedTools: [],
        error: null,
        completedAt: null,
        createdAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:03Z",
    };
}

describe("SqliteTurnStore", () => {
    it("migration creates the agent_loop_turns table and index", async () => {
        const { db } = await loadStore();

        const tables = await sql<{ name: string }>`
            select name from sqlite_master
            where type = 'table' and name = 'agent_loop_turns'
        `.execute(db);
        expect(tables.rows).toHaveLength(1);

        const indexes = await sql<{ name: string }>`
            select name from sqlite_master
            where type = 'index' and name = 'agent_loop_turns_created_at_idx'
        `.execute(db);
        expect(indexes.rows).toHaveLength(1);
    });

    it("round-trips every column", async () => {
        const { store } = await loadStore();
        const turn = sampleTurn("t1");

        await store.create(turn);
        expect(await store.get("t1")).toEqual(turn);

        const updated = {
            ...turn,
            dispatchedTools: [{ toolCallId: "tc1", dispatchedAt: "2026-06-12T00:00:04Z" }],
            error: { message: "boom", code: "E1", details: { hint: "x" }, at: "2026-06-12T00:00:05Z" },
            completedAt: "2026-06-12T00:00:06Z",
            updatedAt: "2026-06-12T00:00:06Z",
        };
        await store.update(updated);
        expect(await store.get("t1")).toEqual(updated);
    });

    it("returns null for unknown ids and rejects updates to missing turns", async () => {
        const { store } = await loadStore();
        expect(await store.get("missing")).toBeNull();
        await expect(store.update(sampleTurn("missing"))).rejects.toThrow("Turn not found");
    });

    it("fails loudly on a corrupted JSON column", async () => {
        const { store, db } = await loadStore();
        await store.create(sampleTurn("t1"));

        await db
            .updateTable("agent_loop_turns")
            .set({ permission_decisions: JSON.stringify([{ bogus: true }]) })
            .where("id", "=", "t1")
            .execute();

        await expect(store.get("t1")).rejects.toThrow();
    });
});
