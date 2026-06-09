import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let workspaceDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-watcher-test-"));
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
    delete process.env.ROWBOAT_WORKDIR;
    vi.doUnmock("../knowledge/version_history.js");
    vi.doUnmock("../knowledge/deprecate_today_note.js");
    vi.resetModules();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("workspace watcher ignores", () => {
    it("ignores SQLite storage files under db", async () => {
        const watcher = await import("./watcher.js");

        expect(watcher.shouldIgnoreWorkspacePath(path.join(workspaceDir, "db"))).toBe(true);
        expect(watcher.shouldIgnoreWorkspacePath(path.join(workspaceDir, "db", "rowboat.sqlite"))).toBe(true);
        expect(watcher.shouldIgnoreWorkspacePath(path.join(workspaceDir, "db", "rowboat.sqlite-wal"))).toBe(true);
        expect(watcher.shouldIgnoreWorkspacePath(path.join(workspaceDir, "knowledge", "note.md"))).toBe(false);
    });
});
