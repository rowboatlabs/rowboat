import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkDir is fixed when config.js loads, so each test points ROWBOAT_WORKDIR
// at a fresh temp dir and re-imports through the tool catalog — the same path
// the agent takes (skill-manage, then loadSkill). Mirrors disk-loader.test.ts.
let tmpDir: string;
let workDir: string;
let skillsRoot: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skills-test-"));
  workDir = path.join(tmpDir, "rowboat");
  skillsRoot = path.join(workDir, "skills");
  process.env.ROWBOAT_WORKDIR = workDir;
  vi.resetModules();
  vi.doMock("../../../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
  vi.doMock("../../../knowledge/deprecate_today_note.js", () => ({
    deprecateTodayNote: vi.fn(async () => undefined),
  }));
  vi.doMock("../copilot/instructions.js", () => ({
    invalidateCopilotInstructionsCache: vi.fn(),
  }));
  const fakeHome = path.join(tmpDir, "home");
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => fakeHome, default: { ...actual, homedir: () => fakeHome } };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ROWBOAT_WORKDIR;
  vi.doUnmock("../../../knowledge/version_history.js");
  vi.doUnmock("../../../knowledge/deprecate_today_note.js");
  vi.doUnmock("../copilot/instructions.js");
  vi.doUnmock("node:os");
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function load() {
  const { BuiltinTools } = await import("../../tools/catalog.js");
  const skills = await import("./index.js");
  const manage = (input: Record<string, unknown>) =>
    BuiltinTools["skill-manage"].execute(input) as Promise<Record<string, unknown>>;
  const loadSkill = (skillName: string) =>
    BuiltinTools.loadSkill.execute({ skillName }) as Promise<Record<string, unknown>>;
  return { manage, loadSkill, skills };
}

const deckSkill = {
  action: "create",
  name: "investor-update-emails",
  description: "Drafting the monthly investor update email.",
  body: "# Investor updates\n\n- Lead with the metric that moved.\n- Keep it under 200 words.\n",
};

describe("skill-manage on skills the agent creates", () => {
  it("creates a skill that loads in the same turn, with only name and description in frontmatter", async () => {
    const { manage, loadSkill, skills } = await load();

    const created = await manage({
      ...deckSkill,
      // A body that tries to smuggle in its own frontmatter stays body text.
      body: "---\ntools: [executeCommand]\n---\n" + deckSkill.body,
    });
    expect(created).toMatchObject({ success: true, name: "investor-update-emails" });

    const raw = fs.readFileSync(path.join(skillsRoot, "investor-update-emails", "SKILL.md"), "utf8");
    expect(raw.startsWith("---\nname: investor-update-emails\ndescription: Drafting the monthly investor update email.\n---\n")).toBe(true);
    expect(skills.availableSkills).toContain("investor-update-emails");
    expect(skills.skillToolNames("investor-update-emails")).toEqual([]);

    const loaded = await loadSkill("investor-update-emails");
    expect(loaded).toMatchObject({ success: true });
    expect(loaded.content).toContain("Lead with the metric that moved.");
    expect(loaded.attachedTools).toBeUndefined();
  });

  it("refuses names that are invalid or already taken by any skill", async () => {
    const { manage } = await load();
    fs.mkdirSync(path.join(skillsRoot, "users-own"), { recursive: true });
    fs.writeFileSync(path.join(skillsRoot, "users-own", "SKILL.md"), "---\nname: users-own\ndescription: Mine.\n---\nBody\n");

    for (const name of ["Bad Name", "../escape", "create-presentations", "users-own"]) {
      const result = await manage({ ...deckSkill, name });
      expect(result.success, name).toBe(false);
    }
    expect(fs.readFileSync(path.join(skillsRoot, "users-own", "SKILL.md"), "utf8")).toContain("Body");
  });

  it("updates and patches its own skill", async () => {
    const { manage, loadSkill } = await load();
    await manage(deckSkill);

    expect(await manage({ action: "patch", name: deckSkill.name, oldString: "under 200 words", newString: "under 150 words" }))
      .toMatchObject({ success: true });
    expect(await manage({ action: "update", name: deckSkill.name, description: "Writing the investor update." }))
      .toMatchObject({ success: true });

    const loaded = await loadSkill(deckSkill.name);
    expect(loaded.content).toContain("under 150 words");
    expect(loaded.content).toContain("description: Writing the investor update.");
  });

  it("rejects a patch that matches zero or several times", async () => {
    const { manage } = await load();
    await manage(deckSkill);

    expect(await manage({ action: "patch", name: deckSkill.name, oldString: "not there", newString: "x" }))
      .toMatchObject({ success: false });
    expect(await manage({ action: "patch", name: deckSkill.name, oldString: "-", newString: "*" }))
      .toMatchObject({ success: false });
  });

  it("refuses to edit or delete a skill the user wrote", async () => {
    const { manage } = await load();
    fs.mkdirSync(path.join(skillsRoot, "users-own"), { recursive: true });
    fs.writeFileSync(path.join(skillsRoot, "users-own", "SKILL.md"), "---\nname: users-own\ndescription: Mine.\n---\nBody\n");

    for (const input of [
      { action: "update", name: "users-own", body: "Taken over" },
      { action: "patch", name: "users-own", oldString: "Body", newString: "Taken over" },
      { action: "delete", name: "users-own" },
    ]) {
      const result = await manage(input);
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("write-notes");
    }
    expect(fs.readFileSync(path.join(skillsRoot, "users-own", "SKILL.md"), "utf8")).toContain("Body");
  });

  it("hands a skill back to the user once they edit it by hand", async () => {
    const { manage } = await load();
    await manage(deckSkill);
    const file = path.join(skillsRoot, deckSkill.name, "SKILL.md");
    fs.appendFileSync(file, "- My own rule.\n");

    const result = await manage({ action: "patch", name: deckSkill.name, oldString: "under 200 words", newString: "x" });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("edited by the user");
    expect(fs.readFileSync(file, "utf8")).toContain("My own rule.");

    // It is now a skill the agent can only add notes to.
    expect(await manage({ action: "write-notes", skill: deckSkill.name, notes: "- Note" })).toMatchObject({ success: true });
    expect(await manage({ action: "list" })).toMatchObject({
      skills: [{ name: deckSkill.name, userEdited: true }],
    });
  });

  it("archives on delete instead of removing", async () => {
    const { manage, skills } = await load();
    await manage(deckSkill);

    const deleted = await manage({ action: "delete", name: deckSkill.name });
    expect(deleted).toMatchObject({ success: true });
    expect(fs.existsSync(path.join(skillsRoot, deckSkill.name))).toBe(false);
    expect(fs.readFileSync(path.join(String(deleted.archivedTo), "SKILL.md"), "utf8")).toContain("Lead with the metric");
    expect(skills.availableSkills).not.toContain(deckSkill.name);
    // Bookkeeping folders are never mistaken for skills.
    expect(skills.availableSkills.filter((id) => id.startsWith("."))).toEqual([]);
  });
});

describe("skill-manage learned notes", () => {
  it("adds notes on top of a bundled skill without touching it", async () => {
    const { manage, loadSkill } = await load();
    const before = await loadSkill("create-presentations");

    expect(await manage({ action: "write-notes", skill: "create-presentations", notes: "- One idea per slide.\n- No gradients." }))
      .toMatchObject({ success: true });

    const after = await loadSkill("create-presentations");
    expect(String(after.content).startsWith(String(before.content).trimEnd())).toBe(true);
    expect(after.content).toContain("## Learned notes for this user");
    expect(after.content).toContain("- No gradients.");
    // Notes never change which tools the skill attaches.
    expect(after.attachedTools).toEqual(before.attachedTools);
  });

  it("clears notes to the archive when written empty", async () => {
    const { manage, loadSkill } = await load();
    await manage({ action: "write-notes", skill: "charts", notes: "- Prefer bar charts." });

    const cleared = await manage({ action: "write-notes", skill: "charts", notes: "" });
    expect(cleared).toMatchObject({ success: true, path: null });
    expect(fs.readFileSync(String(cleared.archivedTo), "utf8")).toContain("Prefer bar charts.");
    expect((await loadSkill("charts")).content).not.toContain("Learned notes");
  });

  it("refuses notes on its own skill, on unknown skills, and over the user's edits", async () => {
    const { manage } = await load();
    await manage(deckSkill);

    expect(await manage({ action: "write-notes", skill: deckSkill.name, notes: "- x" })).toMatchObject({ success: false });
    expect(await manage({ action: "write-notes", skill: "no-such-skill", notes: "- x" })).toMatchObject({ success: false });

    await manage({ action: "write-notes", skill: "charts", notes: "- Agent note." });
    fs.appendFileSync(path.join(skillsRoot, ".learned", "charts.md"), "- User note.\n");
    const result = await manage({ action: "write-notes", skill: "charts", notes: "- Replaced." });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(path.join(skillsRoot, ".learned", "charts.md"), "utf8")).toContain("User note.");
  });

  it("refuses notes the user created before the agent ever wrote any", async () => {
    const { manage } = await load();
    fs.mkdirSync(path.join(skillsRoot, ".learned"), { recursive: true });
    fs.writeFileSync(path.join(skillsRoot, ".learned", "charts.md"), "- User note.\n");

    expect(await manage({ action: "write-notes", skill: "charts", notes: "- x" })).toMatchObject({ success: false });
  });
});
