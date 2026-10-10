import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeKey } from "./fileops.js";

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-planner-memory-test-"));
    process.env.ROWBOAT_WORKDIR = tmpDir;
    vi.resetModules();
    // config.js kicks off async filesystem/git initialization at import time.
    // Keep these tests focused on planner-memory's files.
    vi.doMock("../knowledge/version_history.js", () => ({
        commitAll: vi.fn(async () => undefined),
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

async function loadPlannerMemory() {
    return import("./planner-memory.js");
}

describe("planner memory sticky dismissals", () => {
    it("keeps dismissed keys sticky after the bounded feedback ledger rolls over", async () => {
        const { recordPlannerSignal, stickyDismissedKeys } = await loadPlannerMemory();
        const dismissed = "Resurface quarterly pricing research";

        await recordPlannerSignal("dismissed", dismissed);
        expect(await stickyDismissedKeys()).toContain(normalizeKey(dismissed));

        for (let i = 0; i < 260; i++) {
            const text = `Unrelated planner item ${i}`;
            await recordPlannerSignal(i % 2 === 0 ? "proposed" : "ran", text);
        }

        expect(await stickyDismissedKeys()).toContain(normalizeKey(dismissed));
    });

    it("treats taught signals as sticky dismissals", async () => {
        const { recordPlannerSignal, stickyDismissedKeys } = await loadPlannerMemory();
        const taught = "Suggest a weekly vanity metrics review";

        await recordPlannerSignal("taught", taught);

        expect(await stickyDismissedKeys()).toEqual(new Set([normalizeKey(taught)]));
    });

    it("removes a sticky dismissal after a later ran or kept signal for the same key", async () => {
        const { recordPlannerSignal, stickyDismissedKeys } = await loadPlannerMemory();
        const ran = "Draft investor update";
        const kept = "Review onboarding funnel";

        await recordPlannerSignal("dismissed", ran);
        await recordPlannerSignal("taught", kept);
        expect(await stickyDismissedKeys()).toEqual(new Set([
            normalizeKey(ran),
            normalizeKey(kept),
        ]));

        await recordPlannerSignal("ran", ran);
        expect(await stickyDismissedKeys()).toEqual(new Set([normalizeKey(kept)]));

        await recordPlannerSignal("kept", kept);
        expect(await stickyDismissedKeys()).toEqual(new Set());
    });
});
