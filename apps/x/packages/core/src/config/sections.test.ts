import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkDir is resolved at module load, so each test gets a fresh temp workdir
// via ROWBOAT_WORKDIR + resetModules + dynamic import (same pattern as
// filesystem/files.test.ts).
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-sections-test-"));
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

async function loadSections() {
  return import("./sections.js");
}

async function write(rel: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(tmpDir, rel)), { recursive: true });
  await fs.writeFile(path.join(tmpDir, rel), content);
}

const finishedOnboarding = () => write("config/note_creation.json", JSON.stringify({ onboardingComplete: true }));

describe("optional sections", () => {
  it("starts a new install with Todo and Apps off, and remembers it", async () => {
    const { getSections } = await loadSections();
    expect(getSections()).toEqual({ todo: false, apps: false });
    // Finishing onboarding later doesn't re-decide.
    await finishedOnboarding();
    await write("apps/notes/manifest.json", "{}");
    expect(getSections()).toEqual({ todo: false, apps: false });
  });

  it("keeps on, for an existing install, each section it has used", async () => {
    await finishedOnboarding();
    await write("todo.md", "- [ ] Ship the onboarding\n");
    const { getSections } = await loadSections();
    expect(getSections()).toEqual({ todo: true, apps: false });
  });

  it("treats an untouched seeded list as unused, and archived items as used", async () => {
    await finishedOnboarding();
    const { TODO_SEED } = await import("../todo/fileops.js");
    await write("todo.md", TODO_SEED);
    await write("apps/tracker/manifest.json", "{}");
    const first = await loadSections();
    expect(first.getSections()).toEqual({ todo: false, apps: true });

    await fs.rm(path.join(tmpDir, "config", "app_settings.json"));
    await write("todo/archive/2026-10.md", "- [x] Done\n");
    vi.resetModules();
    const second = await loadSections();
    expect(second.getSections()).toEqual({ todo: true, apps: true });
  });

  it("changes only what Settings asks", async () => {
    const { getSections, setSections } = await loadSections();
    expect(setSections({ apps: true })).toEqual({ todo: false, apps: true });
    expect(getSections()).toEqual({ todo: false, apps: true });
  });
});
