import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Session } from "./types.js";

let tmpDir: string;
let workspaceDir: string;
let storageModule: typeof import("../storage/index.js") | null = null;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-sessions-test-"));
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
    const { SqliteSessionStore } = await import("./sqlite-session-store.js");
    return { store: new SqliteSessionStore(storageModule.getDb()), db: storageModule.getDb() };
}

function sampleSession(
    id: string,
    overrides: Partial<z.infer<typeof Session>> = {},
): z.infer<typeof Session> {
    return {
        id,
        agentId: "agent-1",
        title: "a chat",
        createdAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:00Z",
        ...overrides,
    };
}

describe("SqliteSessionStore", () => {
    it("migration creates the sessions table and index", async () => {
        const { db } = await loadStore();

        const tables = await sql<{ name: string }>`
            select name from sqlite_master
            where type = 'table' and name = 'sessions'
        `.execute(db);
        expect(tables.rows).toHaveLength(1);

        const indexes = await sql<{ name: string }>`
            select name from sqlite_master
            where type = 'index' and name = 'sessions_updated_at_idx'
        `.execute(db);
        expect(indexes.rows).toHaveLength(1);
    });

    it("round-trips every column", async () => {
        const { store } = await loadStore();
        const session = sampleSession("s1");

        await store.create(session);
        expect(await store.get("s1")).toEqual(session);

        const updated = { ...session, title: "renamed", updatedAt: "2026-06-12T01:00:00Z" };
        await store.update(updated);
        expect(await store.get("s1")).toEqual(updated);

        const nulls = sampleSession("s2", { agentId: null, title: null });
        await store.create(nulls);
        expect(await store.get("s2")).toEqual(nulls);
    });

    it("lists most recently updated first, with an optional agent filter", async () => {
        const { store } = await loadStore();
        const older = sampleSession("s1", { updatedAt: "2026-06-12T00:00:01Z" });
        const newer = sampleSession("s2", { updatedAt: "2026-06-12T00:00:02Z" });
        const otherAgent = sampleSession("s3", {
            agentId: "agent-2",
            updatedAt: "2026-06-12T00:00:03Z",
        });
        await store.create(older);
        await store.create(newer);
        await store.create(otherAgent);

        expect((await store.list()).map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
        expect((await store.list({ agentId: "agent-1" })).map((s) => s.id)).toEqual(["s2", "s1"]);
    });

    it("returns null for unknown ids and rejects updates to missing sessions", async () => {
        const { store } = await loadStore();
        expect(await store.get("missing")).toBeNull();
        await expect(store.update(sampleSession("missing"))).rejects.toThrow("Session not found");
    });
});
