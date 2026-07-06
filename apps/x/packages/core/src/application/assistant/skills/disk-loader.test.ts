import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SKILL_ROOTS is computed when disk-loader.js loads, from WorkDir (resolved in
// config.js from ROWBOAT_WORKDIR) and homedir(). Both overrides must be in
// place before the module is imported — hence resetModules + dynamic import
// per test, mirroring filesystem/files.test.ts.
let tmpDir: string;
let workDir: string;
let fakeHomeDir: string;
let rowboatSkillsRoot: string;
let agentsSkillsRoot: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "disk-skills-test-"));
  workDir = path.join(tmpDir, "rowboat");
  fakeHomeDir = path.join(tmpDir, "home");
  rowboatSkillsRoot = path.join(workDir, "skills");
  agentsSkillsRoot = path.join(fakeHomeDir, ".agents", "skills");
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

async function loadDiskLoader() {
  return import("./disk-loader.js");
}

function writeSkill(root: string, folder: string, contents: string): string {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  const skillFile = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillFile, contents);
  return skillFile;
}

describe("SKILL_ROOTS", () => {
  it("derives the rowboat root from ROWBOAT_WORKDIR and the agents root from homedir", async () => {
    const { SKILL_ROOTS } = await loadDiskLoader();

    expect(SKILL_ROOTS).toEqual([rowboatSkillsRoot, agentsSkillsRoot]);
  });
});

describe("loadDiskSkills", () => {
  it("loads a valid skill with id/title/summary, raw content, and absolute paths", async () => {
    const raw = [
      "---",
      "name: Test Skill",
      "description: Does test things.",
      "---",
      "",
      "# Test Skill",
      "",
      "Body of the skill.",
      "",
    ].join("\n");
    const skillFile = writeSkill(rowboatSkillsRoot, "test-skill", raw);

    const { loadDiskSkills } = await loadDiskLoader();
    const skills = loadDiskSkills();

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.id).toBe("test-skill");
    expect(skill.title).toBe("Test Skill");
    expect(skill.summary).toBe("Does test things.");
    expect(skill.content).toBe(raw);
    expect(skill.dir).toBe(path.join(rowboatSkillsRoot, "test-skill"));
    expect(path.isAbsolute(skill.dir)).toBe(true);
    expect(skill.skillFile).toBe(skillFile);
    expect(path.isAbsolute(skill.skillFile)).toBe(true);
  });

  it("handles folded multi-line descriptions and nested metadata blocks", async () => {
    const raw = [
      "---",
      "name: vercel-deploy",
      "description: >-",
      "  Deploy a project to Vercel",
      "  with zero configuration.",
      "metadata:",
      "  category: deployment",
      "  tags:",
      "    - vercel",
      "    - deploy",
      "---",
      "",
      "Instructions here.",
      "",
    ].join("\n");
    writeSkill(rowboatSkillsRoot, "vercel-deploy", raw);

    const { loadDiskSkills } = await loadDiskLoader();
    const skills = loadDiskSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].title).toBe("vercel-deploy");
    expect(skills[0].summary).toBe("Deploy a project to Vercel with zero configuration.");
    expect(skills[0].content).toBe(raw);
  });

  it("skips skills missing name or description without throwing", async () => {
    writeSkill(rowboatSkillsRoot, "no-description", [
      "---",
      "name: No Description",
      "---",
      "Body.",
    ].join("\n"));
    writeSkill(rowboatSkillsRoot, "no-name", [
      "---",
      "description: Has no name.",
      "---",
      "Body.",
    ].join("\n"));
    writeSkill(rowboatSkillsRoot, "valid", [
      "---",
      "name: Valid",
      "description: The only loadable one.",
      "---",
      "Body.",
    ].join("\n"));

    const { loadDiskSkills } = await loadDiskLoader();
    const skills = loadDiskSkills();

    expect(skills.map((s) => s.id)).toEqual(["valid"]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping 'no-description'"),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping 'no-name'"),
    );
  });

  it("skips folders without a SKILL.md", async () => {
    fs.mkdirSync(path.join(rowboatSkillsRoot, "empty-folder"), { recursive: true });
    fs.writeFileSync(path.join(rowboatSkillsRoot, "stray-file.md"), "not a skill folder");

    const { loadDiskSkills } = await loadDiskLoader();

    expect(loadDiskSkills()).toEqual([]);
  });

  it("prefers the rowboat root when the same skill id exists in both roots", async () => {
    writeSkill(rowboatSkillsRoot, "dup", [
      "---",
      "name: Rowboat Dup",
      "description: From the rowboat root.",
      "---",
      "Rowboat body.",
    ].join("\n"));
    writeSkill(agentsSkillsRoot, "dup", [
      "---",
      "name: Agents Dup",
      "description: From the agents root.",
      "---",
      "Agents body.",
    ].join("\n"));

    const { loadDiskSkills } = await loadDiskLoader();
    const skills = loadDiskSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].title).toBe("Rowboat Dup");
    expect(skills[0].dir).toBe(path.join(rowboatSkillsRoot, "dup"));
  });

  it("returns [] when the roots do not exist", async () => {
    // config.js creates the rowboat skills dir on load, so import first, then
    // remove it. The agents root was never created.
    const { loadDiskSkills } = await loadDiskLoader();
    fs.rmSync(rowboatSkillsRoot, { recursive: true, force: true });

    expect(loadDiskSkills()).toEqual([]);
  });

  it("slugifies folder names into skill ids", async () => {
    writeSkill(rowboatSkillsRoot, "My_Skill Name", [
      "---",
      "name: My Skill",
      "description: Slug test.",
      "---",
      "Body.",
    ].join("\n"));

    const { loadDiskSkills } = await loadDiskLoader();
    const skills = loadDiskSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("my-skill-name");
  });
});
