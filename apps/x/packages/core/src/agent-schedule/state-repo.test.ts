import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const { workDir } = vi.hoisted(() => ({ workDir: { path: "" } }));
vi.mock("../config/config.js", () => ({ get WorkDir() { return workDir.path; } }));
import { FSAgentScheduleStateRepo } from "./state-repo.js";

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workDir.path, { recursive: true, force: true });
});

it("preserves concurrent updates from separate repository instances", async () => {
    workDir.path = await fs.mkdtemp(path.join(os.tmpdir(), "schedule-state-"));
    await fs.mkdir(path.join(workDir.path, "config"));
    const first = new FSAgentScheduleStateRepo();
    const second = new FSAgentScheduleStateRepo();
    await first.ensureState();

    const readFile = fs.readFile.bind(fs);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let captured!: () => void;
    const reading = new Promise<void>(resolve => { captured = resolve; });
    vi.spyOn(fs, "readFile").mockImplementationOnce(async (file, options) => {
        const snapshot = await readFile(file, options);
        captured();
        await gate;
        return snapshot;
    });

    const updateFirst = first.updateAgentState("first", { status: "running" });
    await reading;
    const updateSecond = second.updateAgentState("second", { runCount: 2 });
    // Let a writer without the shared lock finish against the old snapshot.
    const otherCompleted = await Promise.race([
        updateSecond.then(() => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), 50)),
    ]);
    release();
    await Promise.all([updateFirst, updateSecond]);
    expect((await first.getState()).agents).toMatchObject({
        first: { status: "running" },
        second: { runCount: 2 },
    });
    expect(otherCompleted).toBe(false);
});
