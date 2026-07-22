import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkDir is resolved at module load, so each test gets a fresh temp workdir
// via ROWBOAT_WORKDIR + resetModules + dynamic import (same pattern as
// filesystem/files.test.ts).
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-app-version-test-"));
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

async function loadAppVersion() {
  return import("./app_version.js");
}

const stampPath = () => path.join(tmpDir, "config", "app-version.json");

async function readStamp(): Promise<unknown> {
  return JSON.parse(await fs.readFile(stampPath(), "utf-8"));
}

async function writeStamp(content: string): Promise<void> {
  await fs.mkdir(path.dirname(stampPath()), { recursive: true });
  await fs.writeFile(stampPath(), content);
}

describe("recordAppVersion", () => {
  it("treats a missing stamp as a fresh install and writes one", async () => {
    const { recordAppVersion } = await loadAppVersion();

    expect(recordAppVersion("1.0.0")).toBeNull();
    expect(await readStamp()).toEqual({ version: "1.0.0" });
  });

  it("returns null when the version is unchanged", async () => {
    await writeStamp(JSON.stringify({ version: "1.0.0" }));
    const { recordAppVersion } = await loadAppVersion();

    expect(recordAppVersion("1.0.0")).toBeNull();
    expect(await readStamp()).toEqual({ version: "1.0.0" });
  });

  it("returns the previous version once after a change and restamps", async () => {
    await writeStamp(JSON.stringify({ version: "1.0.0" }));
    const { recordAppVersion } = await loadAppVersion();

    expect(recordAppVersion("1.1.0")).toBe("1.0.0");
    expect(await readStamp()).toEqual({ version: "1.1.0" });
    // second call on the same version — already stamped, nothing to report
    expect(recordAppVersion("1.1.0")).toBeNull();
  });

  it("treats a corrupt stamp as a fresh install (no spurious updated notice)", async () => {
    await writeStamp("{not json");
    const { recordAppVersion } = await loadAppVersion();

    expect(recordAppVersion("1.1.0")).toBeNull();
    expect(await readStamp()).toEqual({ version: "1.1.0" });
  });

  it("ignores a stamp whose version is not a string", async () => {
    await writeStamp(JSON.stringify({ version: 5 }));
    const { recordAppVersion } = await loadAppVersion();

    expect(recordAppVersion("1.1.0")).toBeNull();
  });

  it("reports downgrades too — filtering is the caller's job", async () => {
    await writeStamp(JSON.stringify({ version: "2.0.0" }));
    const { recordAppVersion } = await loadAppVersion();

    expect(recordAppVersion("1.0.0")).toBe("2.0.0");
    expect(await readStamp()).toEqual({ version: "1.0.0" });
  });
});

describe("isVersionUpgrade", () => {
  it.each([
    ["1.0.0", "1.0.1"],
    ["1.0.0", "1.1.0"],
    ["1.9.0", "1.10.0"], // numeric compare, not lexicographic
    ["0.9", "1.0.0"], // shorter version pads with zeros
    ["1.2", "1.2.1"],
    ["v1.0.0", "v1.0.1"], // leading v tolerated
    ["1.2.3-beta.1", "1.2.4"], // prerelease suffix ignored
  ])("upgrade: %s -> %s", async (from, to) => {
    const { isVersionUpgrade } = await loadAppVersion();
    expect(isVersionUpgrade(from, to)).toBe(true);
  });

  it.each([
    ["1.0.0", "1.0.0"], // unchanged
    ["1.1.0", "1.0.0"], // downgrade
    ["1.10.0", "1.9.9"],
    ["1.2.3", "1.2.3-beta.1"], // prerelease ignored -> equal
    ["1.2.3", "1.2"], // padded equal-then-lower
    ["abc", "1.0.0"], // unparseable input fails quiet
    ["1.0.0", "1.0.x"],
  ])("not an upgrade: %s -> %s", async (from, to) => {
    const { isVersionUpgrade } = await loadAppVersion();
    expect(isVersionUpgrade(from, to)).toBe(false);
  });
});
