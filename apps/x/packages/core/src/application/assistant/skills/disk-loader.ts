import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { WorkDir } from "../../../config/config.js";
import { splitFrontmatter } from "../../lib/parse-frontmatter.js";

/**
 * A skill discovered on disk. Matches the bundled SkillDefinition shape
 * (id/title/summary/content) plus provenance about where it came from.
 */
export type DiskSkill = {
  id: string;        // slugified folder name
  title: string;     // frontmatter `name`
  summary: string;   // frontmatter `description`
  content: string;   // full raw SKILL.md text
  dir: string;       // absolute path to the skill folder
  skillFile: string; // absolute path to the SKILL.md
};

// Locations scanned for <skill-name>/SKILL.md subfolders. The rowboat root is
// derived from WorkDir so it honors the ROWBOAT_WORKDIR override (defaults to
// ~/.rowboat/skills); it is scanned first so it wins on id collisions across
// the two roots. The ~/.agents/skills root is an external shared convention,
// not tied to WorkDir. Exported so the live-reload watcher watches exactly the
// same locations.
export const SKILL_ROOTS = [
  path.join(WorkDir, "skills"),
  path.join(homedir(), ".agents", "skills"),
];

const slugify = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_]+/g, "-");

/**
 * Synchronously scan the known skill roots (one level deep) for disk skills.
 * A missing/empty directory or an unreadable/invalid SKILL.md simply yields no
 * skill for that folder — this function never throws.
 */
export function loadDiskSkills(): DiskSkill[] {
  const skills: DiskSkill[] = [];
  const seen = new Map<string, string>(); // id -> dir that claimed it

  for (const root of SKILL_ROOTS) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      // Directory missing (e.g. ~/.agents/skills absent) — nothing to scan.
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const skillFile = path.join(dir, "SKILL.md");

      let raw: string;
      try {
        raw = fs.readFileSync(skillFile, "utf8");
      } catch {
        console.warn(`[disk-skills] Skipping '${entry.name}': no readable SKILL.md at ${skillFile}`);
        continue;
      }

      // Parse with the real YAML frontmatter helper so folded/multi-line
      // scalars and nested keys (e.g. `metadata:`) are handled correctly.
      let frontmatter: Record<string, unknown>;
      try {
        ({ frontmatter } = splitFrontmatter(raw));
      } catch (err) {
        console.warn(`[disk-skills] Skipping '${entry.name}': failed to parse frontmatter:`, err);
        continue;
      }

      // Coerce a scalar (including folded/multi-line) frontmatter value to a
      // single trimmed string; anything non-string yields "".
      const asString = (value: unknown): string =>
        typeof value === "string" ? value.trim() : "";
      const name = asString(frontmatter.name);
      const description = asString(frontmatter.description);
      if (!name || !description) {
        console.warn(`[disk-skills] Skipping '${entry.name}': SKILL.md is missing required 'name' and/or 'description' frontmatter.`);
        continue;
      }

      const id = slugify(entry.name);
      const existing = seen.get(id);
      if (existing) {
        console.warn(`[disk-skills] Duplicate skill id '${id}' from ${dir} ignored; already provided by ${existing}.`);
        continue;
      }
      seen.set(id, dir);

      skills.push({ id, title: name, summary: description, content: raw, dir, skillFile });
    }
  }

  return skills;
}
