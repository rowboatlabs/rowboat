import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WorkDir } from "../../../config/config.js";
import { joinFrontmatter, splitFrontmatter } from "../../../application/lib/parse-frontmatter.js";

// Agent-authored skills (2026-10-05, first step of the Hermes-style learning
// loop). The agent may create, edit and delete skills it wrote itself, and may
// keep "learned notes" on top of any other skill (bundled, user-written, or
// ~/.agents/skills) without ever editing that skill. Ownership lives in a
// manifest of content hashes rather than in frontmatter, because anything
// that can write the file could forge a frontmatter flag; a hand edit changes
// the hash, which hands the skill (or note) back to the user.
//
// Everything here is synchronous on purpose: one tool call is one
// uninterrupted read-check-write, so two concurrent calls cannot interleave
// between the ownership check and the write.

export const AGENT_SKILLS_ROOT = path.join(WorkDir, "skills");
const MANIFEST_FILE = path.join(AGENT_SKILLS_ROOT, ".agent-skills.json");
export const LEARNED_NOTES_DIR = path.join(AGENT_SKILLS_ROOT, ".learned");
export const ARCHIVE_DIR = path.join(AGENT_SKILLS_ROOT, ".archive");

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY = 20_000;
const MAX_NOTES = 8_000;

type ManifestEntry = { hash: string; createdAt: string; updatedAt: string };
type Manifest = {
  version: 1;
  skills: Record<string, ManifestEntry>;
  notes: Record<string, ManifestEntry>;
};

export class AgentSkillError extends Error {}

const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function readManifest(): Manifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
    if (parsed && parsed.version === 1 && parsed.skills && parsed.notes) return parsed as Manifest;
  } catch {
    // Missing or unreadable: the agent owns nothing, which is the safe default.
  }
  return { version: 1, skills: {}, notes: {} };
}

function writeManifest(manifest: Manifest): void {
  fs.mkdirSync(AGENT_SKILLS_ROOT, { recursive: true });
  const tmp = `${MANIFEST_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, MANIFEST_FILE);
}

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Never deleted outright: the user can restore anything the agent removed.
function archive(source: string, label: string): string {
  const target = path.join(ARCHIVE_DIR, `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.renameSync(source, target);
  return target;
}

const skillDir = (name: string) => path.join(AGENT_SKILLS_ROOT, name);
const skillFile = (name: string) => path.join(skillDir(name), "SKILL.md");
const notesFile = (skillId: string) => path.join(LEARNED_NOTES_DIR, `${skillId}.md`);

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name) || name.length > MAX_NAME) {
    throw new AgentSkillError(
      `Invalid skill name '${name}': use lowercase letters, digits and single hyphens (max ${MAX_NAME} chars), e.g. 'investor-update-emails'.`,
    );
  }
}

function validateDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) throw new AgentSkillError("A skill needs a description: one line saying when to load it.");
  if (trimmed.length > MAX_DESCRIPTION) {
    throw new AgentSkillError(`Description is ${trimmed.length} chars; keep it under ${MAX_DESCRIPTION}.`);
  }
  if (/\r|\n/.test(trimmed)) throw new AgentSkillError("Keep the description to a single line.");
  return trimmed;
}

function validateBody(body: string): string {
  if (!body.trim()) throw new AgentSkillError("The skill body is empty.");
  if (body.length > MAX_BODY) {
    throw new AgentSkillError(`Skill body is ${body.length} chars; keep it under ${MAX_BODY}. Move detail into a tighter rule set.`);
  }
  return body.endsWith("\n") ? body : `${body}\n`;
}

// Only name and description are ever written to frontmatter. Disk skills
// attach the tools their `tools:`/`allowed-tools:` frontmatter lists when
// loaded, so letting the agent write frontmatter would let it grant itself
// tools (e.g. executeCommand) through a skill it authored.
function renderSkill(name: string, description: string, body: string): string {
  return joinFrontmatter({ name, description }, `\n${body}`);
}

// An agent-owned skill is one in the manifest whose bytes still match the
// recorded hash. Anything else (missing, hand-edited, never ours) is refused.
function requireOwnedSkill(manifest: Manifest, name: string): { raw: string; description: string; body: string } {
  validateName(name);
  const entry = manifest.skills[name];
  const raw = readIfExists(skillFile(name));
  if (!entry || raw === null) {
    throw new AgentSkillError(
      `'${name}' is not a skill you created, so you cannot change it. To improve it, use action 'write-notes' to keep learned notes on top of it.`,
    );
  }
  if (sha256(raw) !== entry.hash) {
    throw new AgentSkillError(
      `'${name}' has been edited by the user since you last wrote it, so it is theirs now. Use action 'write-notes' to add learned notes on top of it instead.`,
    );
  }
  const { frontmatter, body } = splitFrontmatter(raw);
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  return { raw, description, body: body.replace(/^\n/, "") };
}

function recordSkill(manifest: Manifest, name: string, raw: string): void {
  const now = new Date().toISOString();
  const prior = manifest.skills[name];
  manifest.skills[name] = { hash: sha256(raw), createdAt: prior?.createdAt ?? now, updatedAt: now };
}

export type ExistingSkillLookup = {
  // True when any skill (bundled or on disk, in either root) already uses the id.
  isTaken: (id: string) => boolean;
  // True when a skill with this id can be loaded, so notes on it would be read.
  exists: (id: string) => boolean;
};

export function createAgentSkill(
  input: { name: string; description: string; body: string },
  lookup: ExistingSkillLookup,
): { name: string; path: string } {
  validateName(input.name);
  const description = validateDescription(input.description);
  const body = validateBody(input.body);
  if (lookup.isTaken(input.name) || fs.existsSync(skillDir(input.name))) {
    throw new AgentSkillError(
      `A skill named '${input.name}' already exists. Pick another name, or use 'write-notes' to add to the existing one.`,
    );
  }
  const manifest = readManifest();
  const raw = renderSkill(input.name, description, body);
  writeAtomic(skillFile(input.name), raw);
  recordSkill(manifest, input.name, raw);
  writeManifest(manifest);
  return { name: input.name, path: skillFile(input.name) };
}

export function updateAgentSkill(input: { name: string; description?: string; body?: string }): { name: string; path: string } {
  if (input.description === undefined && input.body === undefined) {
    throw new AgentSkillError("Nothing to update: pass a new description, a new body, or both.");
  }
  const manifest = readManifest();
  const current = requireOwnedSkill(manifest, input.name);
  const description = validateDescription(input.description ?? current.description);
  const body = validateBody(input.body ?? current.body);
  const raw = renderSkill(input.name, description, body);
  writeAtomic(skillFile(input.name), raw);
  recordSkill(manifest, input.name, raw);
  writeManifest(manifest);
  return { name: input.name, path: skillFile(input.name) };
}

export function patchAgentSkill(input: { name: string; oldString: string; newString: string }): { name: string; path: string } {
  if (!input.oldString) throw new AgentSkillError("oldString is empty; quote the exact text to replace.");
  const manifest = readManifest();
  const current = requireOwnedSkill(manifest, input.name);
  // The patch only ever touches the body, so it cannot reach the frontmatter.
  const count = current.body.split(input.oldString).length - 1;
  if (count === 0) {
    throw new AgentSkillError(`oldString was not found in '${input.name}'. Load the skill again and quote its current text exactly.`);
  }
  if (count > 1) {
    throw new AgentSkillError(`oldString appears ${count} times in '${input.name}'; include more surrounding text so it matches once.`);
  }
  const body = validateBody(current.body.replace(input.oldString, () => input.newString));
  const raw = renderSkill(input.name, validateDescription(current.description), body);
  writeAtomic(skillFile(input.name), raw);
  recordSkill(manifest, input.name, raw);
  writeManifest(manifest);
  return { name: input.name, path: skillFile(input.name) };
}

export function deleteAgentSkill(input: { name: string }): { name: string; archivedTo: string } {
  const manifest = readManifest();
  requireOwnedSkill(manifest, input.name);
  const archivedTo = archive(skillDir(input.name), input.name);
  delete manifest.skills[input.name];
  writeManifest(manifest);
  return { name: input.name, archivedTo };
}

// Learned notes ride on top of a skill the agent does not own. Its own skills
// it edits directly, so notes on them would just be a second copy.
export function writeLearnedNotes(
  input: { skill: string; notes: string },
  lookup: ExistingSkillLookup,
): { skill: string; path: string | null; archivedTo?: string } {
  validateName(input.skill);
  const manifest = readManifest();
  const ownRaw = manifest.skills[input.skill] ? readIfExists(skillFile(input.skill)) : null;
  if (ownRaw !== null && sha256(ownRaw) === manifest.skills[input.skill].hash) {
    throw new AgentSkillError(`'${input.skill}' is a skill you created; edit it directly with 'update' or 'patch' instead of adding notes.`);
  }
  if (!lookup.exists(input.skill)) {
    throw new AgentSkillError(`No skill named '${input.skill}' exists to add notes to.`);
  }
  const file = notesFile(input.skill);
  const existing = readIfExists(file);
  const entry = manifest.notes[input.skill];
  if (existing !== null && (!entry || sha256(existing) !== entry.hash)) {
    throw new AgentSkillError(
      `The learned notes for '${input.skill}' were edited by the user, so they are theirs now and you cannot change them.`,
    );
  }

  const notes = input.notes.trim();
  if (!notes) {
    if (existing === null) return { skill: input.skill, path: null };
    const archivedTo = archive(file, `${input.skill}.notes.md`);
    delete manifest.notes[input.skill];
    writeManifest(manifest);
    return { skill: input.skill, path: null, archivedTo };
  }
  if (notes.length > MAX_NOTES) {
    throw new AgentSkillError(`Notes are ${notes.length} chars; keep them under ${MAX_NOTES}. Consolidate rather than append.`);
  }
  const text = `${notes}\n`;
  writeAtomic(file, text);
  const now = new Date().toISOString();
  manifest.notes[input.skill] = { hash: sha256(text), createdAt: entry?.createdAt ?? now, updatedAt: now };
  writeManifest(manifest);
  return { skill: input.skill, path: file };
}

export function listAgentSkills(): {
  skills: Array<{ name: string; description: string; userEdited: boolean }>;
  notes: Array<{ skill: string; userEdited: boolean }>;
} {
  const manifest = readManifest();
  const skills = Object.entries(manifest.skills).flatMap(([name, entry]) => {
    const raw = readIfExists(skillFile(name));
    if (raw === null) return [];
    const { frontmatter } = splitFrontmatter(raw);
    const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
    return [{ name, description, userEdited: sha256(raw) !== entry.hash }];
  });
  const notes = Object.entries(manifest.notes).flatMap(([skill, entry]) => {
    const text = readIfExists(notesFile(skill));
    return text === null ? [] : [{ skill, userEdited: sha256(text) !== entry.hash }];
  });
  return { skills, notes };
}

// Appended to a skill's content by loadSkill. The notes are this user's
// corrections, so they win over the generic defaults they sit on top of.
// Read at load time (small file, one read) so no cache can go stale.
export function withLearnedNotes(skillId: string, content: string): string {
  if (!NAME_PATTERN.test(skillId)) return content;
  const notes = readIfExists(notesFile(skillId))?.trim();
  if (!notes) return content;
  return [
    content.replace(/\s+$/, ""),
    "",
    "## Learned notes for this user",
    "",
    "Kept by the assistant from past sessions with this user. Where they conflict with the guidance above, follow these notes.",
    "",
    notes,
    "",
  ].join("\n");
}
