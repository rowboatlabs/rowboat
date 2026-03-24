/**
 * SkillDefinition — the runtime shape of a parsed skill.
 * Skill content comes from disk (synced from GitHub or user overrides).
 */
export type SkillDefinition = {
  id: string;  // Also used as folder name
  title: string;
  summary: string;
  version: string;  // semver
  content: string;
};
