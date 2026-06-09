import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let workspaceDir: string;
let storageModule: typeof import("./index.js") | null = null;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-storage-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    process.env.ROWBOAT_WORKDIR = workspaceDir;
    vi.resetModules();
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

async function loadStorage() {
    storageModule = await import("./index.js");
    return storageModule;
}

describe("SQLite storage", () => {
    it("throws clearly when accessed before initialization", async () => {
        const storage = await loadStorage();

        expect(() => storage.getDb()).toThrow("SQLite storage has not been initialized");
    });

    it("creates the database under ROWBOAT_WORKDIR/db", async () => {
        const storage = await loadStorage();

        await storage.initStorage();

        expect(storage.getDatabasePath()).toBe(path.join(workspaceDir, "db", "rowboat.sqlite"));
        await expect(fs.access(storage.getDatabasePath())).resolves.toBeUndefined();
    });

    it("runs the initial migration", async () => {
        const storage = await loadStorage();
        await storage.initStorage();

        const result = await sql<{ name: string }>`
            select name
            from sqlite_master
            where type = 'table'
              and name in ('storage_metadata', 'kysely_migration')
            order by name
        `.execute(storage.getDb());

        expect(result.rows.map((row) => row.name)).toEqual(["kysely_migration", "storage_metadata"]);
    });

    it("is idempotent", async () => {
        const storage = await loadStorage();

        await storage.initStorage();
        const firstDb = storage.getDb();
        await storage.initStorage();

        expect(storage.getDb()).toBe(firstDb);
    });

    it("resets the singleton on shutdown", async () => {
        const storage = await loadStorage();

        await storage.initStorage();
        await storage.shutdownStorage();

        expect(() => storage.getDb()).toThrow("SQLite storage has not been initialized");
    });
});
