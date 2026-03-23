import { z } from 'zod';

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
