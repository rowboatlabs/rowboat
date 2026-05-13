import { z } from 'zod';

// SKILL.md frontmatter schema. `name` is the skill id (folder name) and
// `description` is the one-line catalog summary. `hidden: true` keeps a
// skill out of the public catalog while still allowing other skills to
// `{{include:<id>}}` it as content (e.g. shared style guides).
export const SkillFrontmatter = z.object({
    name: z.string().max(64),
    description: z.string().max(1024),
    hidden: z.boolean().optional(),
    license: z.string().optional(),
    metadata: z.object({
        title: z.string().optional(),
    }).passthrough().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

// Skill catalog entry seen by the agent and the renderer (no content body).
export const SkillCatalogEntry = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
});
export type SkillCatalogEntry = z.infer<typeof SkillCatalogEntry>;

// Fully-resolved skill: catalog metadata + body with all {{include:<id>}}
// directives expanded.
export const ResolvedSkill = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    content: z.string(),
});

export type ResolvedSkill = z.infer<typeof ResolvedSkill>;
