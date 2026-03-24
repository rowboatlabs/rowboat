import { z } from 'zod';

// SKILL.md frontmatter schema (Agent Skills spec compliant)
// Top-level: name, description, license, compatibility, allowed-tools, metadata
// Custom Rowboat fields go under metadata
export const SkillFrontmatter = z.object({
    name: z.string().max(64),
    description: z.string().max(1024),
    license: z.string().optional(),
    compatibility: z.string().max(500).optional(),
    "allowed-tools": z.string().optional(),
    metadata: z.object({
        version: z.string().optional(),
        title: z.string().optional(),
        author: z.string().optional(),
        tags: z.string().optional(),
    }).passthrough().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

// Official skill metadata (bundled with app)
export const OfficialSkillMeta = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    version: z.string(),
    source: z.literal("official"),
});

// User override metadata (stored on disk as YAML frontmatter)
export const SkillOverride = z.object({
    base_skill_id: z.string(),
    base_version: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
});

// Parsed override entry (metadata + content)
export const SkillOverrideEntry = z.object({
    skillId: z.string(),
    meta: SkillOverride,
    content: z.string(),
});

// Resolved skill seen by the agent (source-agnostic)
export const ResolvedSkill = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    version: z.string(),
    source: z.enum(["official", "override", "installed"]),
    content: z.string(),
    hasUpdate: z.boolean().optional(),
    baseVersion: z.string().optional(),
});

export type OfficialSkillMeta = z.infer<typeof OfficialSkillMeta>;
export type SkillOverride = z.infer<typeof SkillOverride>;
export type SkillOverrideEntry = z.infer<typeof SkillOverrideEntry>;
export type ResolvedSkill = z.infer<typeof ResolvedSkill>;
