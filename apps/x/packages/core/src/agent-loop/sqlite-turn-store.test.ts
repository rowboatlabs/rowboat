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

function sampleTurn(
    id: string,
    overrides: Partial<z.infer<typeof AgentLoopTurn>> = {},
): z.infer<typeof AgentLoopTurn> {
    return {
        id,
        agentId: "agent-1",
        provider: "openai",
        model: "gpt-x",
        permissionMode: "auto",
        sessionId: null,
        sessionSeq: null,
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
        modelUsage: [
            {
                inputTokens: 120,
                outputTokens: 45,
                totalTokens: 165,
                reasoningTokens: null,
                cachedInputTokens: 80,
                at: "2026-06-12T00:00:03Z",
            },
        ],
        error: null,
        completedAt: null,
        createdAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:03Z",
        ...overrides,
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

    it("round-trips session linkage and queries turns by session in seq order", async () => {
        const { store } = await loadStore();
        const t1 = sampleTurn("t1", { sessionId: "s1", sessionSeq: 1 });
        const t2 = sampleTurn("t2", { sessionId: "s1", sessionSeq: 2 });
        const other = sampleTurn("t3", { sessionId: "s2", sessionSeq: 1 });
        // insert out of order to prove ordering comes from seq
        await store.create(t2);
        await store.create(t1);
        await store.create(other);
        await store.create(sampleTurn("standalone"));

        expect(await store.get("t1")).toEqual(t1);
        expect(await store.listBySession("s1")).toEqual([t1, t2]);
        expect(await store.latestForSession("s1")).toEqual(t2);
        expect(await store.latestForSession("missing")).toBeNull();
        expect(await store.listBySession("missing")).toEqual([]);
    });

    it("rejects a duplicate session seq via the unique index", async () => {
        const { store } = await loadStore();
        await store.create(sampleTurn("t1", { sessionId: "s1", sessionSeq: 1 }));
        await expect(
            store.create(sampleTurn("t2", { sessionId: "s1", sessionSeq: 1 })),
        ).rejects.toThrow();
        // standalone turns never conflict (NULL session_id)
        await store.create(sampleTurn("t3"));
        await store.create(sampleTurn("t4"));
    });

    describe("transcript prefix dedup", () => {
        // t1's tool call is resolved, so its closed transcript IS its messages
        // (3 of them) — t2 extends it with a new exchange.
        function chainTurns() {
            const t1 = sampleTurn("t1", { sessionId: "s1", sessionSeq: 1 });
            const t2 = sampleTurn("t2", {
                sessionId: "s1",
                sessionSeq: 2,
                messages: [
                    ...t1.messages,
                    { role: "user", content: "second question" },
                    { role: "assistant", content: "second answer" },
                ],
            });
            return { t1, t2 };
        }

        it("stores only the delta at rest; reads materialize transparently", async () => {
            const { store, db } = await loadStore();
            const { t1, t2 } = chainTurns();
            await store.create(t1);
            await store.create(t2);

            expect(await store.get("t2")).toEqual(t2);
            expect(await store.listBySession("s1")).toEqual([t1, t2]);
            expect(await store.latestForSession("s1")).toEqual(t2);

            const raw = await db
                .selectFrom("agent_loop_turns")
                .select(["messages", "prefix_length"])
                .where("id", "=", "t2")
                .executeTakeFirstOrThrow();
            expect(raw.prefix_length).toBe(3);
            expect(JSON.parse(raw.messages)).toHaveLength(2); // only the new exchange
            expect(raw.messages).not.toContain("let me check"); // t1 content not duplicated
        });

        it("updates rewrite only the delta; the prefix stays deduped", async () => {
            const { store, db } = await loadStore();
            const { t1, t2 } = chainTurns();
            await store.create(t1);
            await store.create(t2);

            const updated = {
                ...t2,
                messages: [...t2.messages, { role: "user" as const, content: "follow-up" }],
                updatedAt: "2026-06-12T00:01:00Z",
            };
            await store.update(updated);

            expect(await store.get("t2")).toEqual(updated);
            const raw = await db
                .selectFrom("agent_loop_turns")
                .select(["messages", "prefix_length"])
                .where("id", "=", "t2")
                .executeTakeFirstOrThrow();
            expect(raw.prefix_length).toBe(3);
            expect(JSON.parse(raw.messages)).toHaveLength(3);
        });

        it("stores the whole transcript when the input does not extend the previous turn", async () => {
            const { store, db } = await loadStore();
            const { t1 } = chainTurns();
            await store.create(t1);
            // compaction-style input: a summary instead of the prior transcript
            const t2 = sampleTurn("t2", {
                sessionId: "s1",
                sessionSeq: 2,
                messages: [{ role: "user", content: "summary of the conversation so far" }],
            });
            await store.create(t2);

            expect(await store.get("t2")).toEqual(t2);
            const raw = await db
                .selectFrom("agent_loop_turns")
                .select("prefix_length")
                .where("id", "=", "t2")
                .executeTakeFirstOrThrow();
            expect(raw.prefix_length).toBe(0);
        });

        it("fails loudly when a deduped turn's predecessor is missing", async () => {
            const { store, db } = await loadStore();
            const { t1, t2 } = chainTurns();
            await store.create(t1);
            await store.create(t2);

            await db.deleteFrom("agent_loop_turns").where("id", "=", "t1").execute();
            await expect(store.get("t2")).rejects.toThrow("previous session turn");
        });
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
