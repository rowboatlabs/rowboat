import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// index.js scans the disk skill roots at module init, and the roots are fixed
// when disk-loader.js/config.js load — so the ROWBOAT_WORKDIR and homedir
// overrides must be in place before the dynamic import in each test, mirroring
// filesystem/files.test.ts.
let tmpDir: string;
let workDir: string;
let fakeHomeDir: string;
let rowboatSkillsRoot: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-index-test-"));
  workDir = path.join(tmpDir, "rowboat");
  fakeHomeDir = path.join(tmpDir, "home");
  rowboatSkillsRoot = path.join(workDir, "skills");
  process.env.ROWBOAT_WORKDIR = workDir;
  vi.resetModules();
  // config.js kicks off these imports on load; stub them so tests stay
  // hermetic (no git init or Today.md migration against the temp workdir).
  vi.doMock("../../../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
  vi.doMock("../../../knowledge/deprecate_today_note.js", () => ({
    deprecateTodayNote: vi.fn(async () => undefined),
  }));
  // Point homedir() at the temp dir so the ~/.agents/skills root never touches
  // the developer's real home directory.
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => fakeHomeDir,
      default: { ...actual, homedir: () => fakeHomeDir },
    };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ROWBOAT_WORKDIR;
  vi.doUnmock("../../../knowledge/version_history.js");
  vi.doUnmock("../../../knowledge/deprecate_today_note.js");
  vi.doUnmock("node:os");
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadSkillsIndex() {
  return import("./index.js");
}

function writeSkill(folder: string, contents: string): string {
  const dir = path.join(rowboatSkillsRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  const skillFile = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillFile, contents);
  return skillFile;
}

describe("skills index (disk skill merge layer)", () => {
  it("includes disk skills in the catalog and resolves them by id and file path", async () => {
    const raw = [
      "---",
      "name: Ship It",
      "description: Ship the thing to production.",
      "---",
      "",
      "# Ship It",
      "",
      "Disk skill body.",
      "",
    ].join("\n");
    const skillFile = writeSkill("ship-it", raw);

    const skills = await loadSkillsIndex();

    expect(skills.availableSkills).toContain("ship-it");

    const catalog = skills.buildSkillCatalog();
    expect(catalog).toContain("## Ship It");
    expect(catalog).toContain(skillFile);
    expect(catalog).toContain("Ship the thing to production.");

    expect(skills.resolveSkill("ship-it")?.content).toBe(raw);
    expect(skills.resolveSkill(skillFile)?.content).toBe(raw);
    expect(skills.resolveSkill("ship-it")?.catalogPath).toBe(skillFile);
  });

  it("keeps the bundled skill when a disk skill uses the same id", async () => {
    writeSkill("meeting-prep", [
      "---",
      "name: Shadow Meeting Prep",
      "description: Disk impostor.",
      "---",
      "DISK CONTENT MARKER",
    ].join("\n"));

    const skills = await loadSkillsIndex();

    const resolved = skills.resolveSkill("meeting-prep");
    expect(resolved?.catalogPath).toBe("src/application/assistant/skills/meeting-prep/skill.ts");
    expect(resolved?.content).not.toContain("DISK CONTENT MARKER");

    const catalog = skills.buildSkillCatalog();
    expect(catalog).toContain("## Meeting Prep");
    expect(catalog).not.toContain("Shadow Meeting Prep");
    expect(skills.availableSkills.filter((id) => id === "meeting-prep")).toHaveLength(1);
  });

  it("refreshDiskSkills picks up skills added and removed on disk", async () => {
    const skills = await loadSkillsIndex();

    expect(skills.resolveSkill("late-arrival")).toBeNull();
    expect(skills.availableSkills).not.toContain("late-arrival");

    const raw = [
      "---",
      "name: Late Arrival",
      "description: Added after module init.",
      "---",
      "Late body.",
    ].join("\n");
    const skillFile = writeSkill("late-arrival", raw);

    // Not visible until refreshed.
    expect(skills.resolveSkill("late-arrival")).toBeNull();
    expect(skills.buildSkillCatalog()).not.toContain("## Late Arrival");

    expect(skills.refreshDiskSkills()).toBe(1);
    expect(skills.availableSkills).toContain("late-arrival");
    expect(skills.buildSkillCatalog()).toContain("## Late Arrival");
    expect(skills.resolveSkill("late-arrival")?.content).toBe(raw);
    expect(skills.resolveSkill(skillFile)?.content).toBe(raw);

    fs.rmSync(path.join(rowboatSkillsRoot, "late-arrival"), { recursive: true, force: true });

    expect(skills.refreshDiskSkills()).toBe(0);
    expect(skills.availableSkills).not.toContain("late-arrival");
    expect(skills.buildSkillCatalog()).not.toContain("## Late Arrival");
    expect(skills.resolveSkill("late-arrival")).toBeNull();
    expect(skills.resolveSkill(skillFile)).toBeNull();
  });
});
