import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkDir is resolved at module load, so each test gets a fresh temp workdir
// via ROWBOAT_WORKDIR + resetModules + dynamic import (same pattern as
// app_version.test.ts).
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-turn-limits-test-"));
  process.env.ROWBOAT_WORKDIR = tmpDir;
  vi.resetModules();
  // config.js fire-and-forgets a git init + Today.md migration on import;
  // mock them out so no repo appears (and races teardown) in the temp workdir.
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

async function loadTurnLimits() {
  return import("./turn_limits.js");
}

const settingsPath = () => path.join(tmpDir, "config", "turn_limits.json");

async function writeSettings(content: string): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), content);
}

describe("loadTurnLimitsSettings", () => {
  it("defaults to the built-in limit (50) when no file exists", async () => {
    const { loadTurnLimitsSettings } = await loadTurnLimits();
    expect(await loadTurnLimitsSettings()).toEqual({ maxModelCalls: 50 });
  });

  it("reads persisted settings", async () => {
    await writeSettings(JSON.stringify({ maxModelCalls: 60, chatMaxModelCalls: 10 }));
    const { loadTurnLimitsSettings } = await loadTurnLimits();
    expect(await loadTurnLimitsSettings()).toEqual({
      maxModelCalls: 60,
      chatMaxModelCalls: 10,
    });
  });

  it("fills a missing global limit from the default", async () => {
    await writeSettings(JSON.stringify({ chatMaxModelCalls: 5 }));
    const { loadTurnLimitsSettings } = await loadTurnLimits();
    expect(await loadTurnLimitsSettings()).toEqual({
      maxModelCalls: 50,
      chatMaxModelCalls: 5,
    });
  });

  it("falls back to defaults on a corrupt file", async () => {
    await writeSettings("{not json");
    const { loadTurnLimitsSettings } = await loadTurnLimits();
    expect(await loadTurnLimitsSettings()).toEqual({ maxModelCalls: 50 });
  });

  it("falls back to defaults on out-of-range values", async () => {
    await writeSettings(JSON.stringify({ maxModelCalls: 5000 }));
    const { loadTurnLimitsSettings } = await loadTurnLimits();
    expect(await loadTurnLimitsSettings()).toEqual({ maxModelCalls: 50 });
  });
});

describe("saveTurnLimitsSettings", () => {
  it("persists valid settings for the next load", async () => {
    const { saveTurnLimitsSettings, loadTurnLimitsSettings } = await loadTurnLimits();
    await saveTurnLimitsSettings({ maxModelCalls: 80, chatMaxModelCalls: 15 });
    expect(await loadTurnLimitsSettings()).toEqual({
      maxModelCalls: 80,
      chatMaxModelCalls: 15,
    });
  });

  it("rejects out-of-range values", async () => {
    const { saveTurnLimitsSettings } = await loadTurnLimits();
    await expect(saveTurnLimitsSettings({ maxModelCalls: 0 })).rejects.toThrow();
    await expect(saveTurnLimitsSettings({ maxModelCalls: 501 })).rejects.toThrow();
    await expect(
      saveTurnLimitsSettings({ maxModelCalls: 20, chatMaxModelCalls: 501 }),
    ).rejects.toThrow();
  });
});
