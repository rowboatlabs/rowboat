import { z } from 'zod';

// SKILL.md frontmatter schema (Agent Skills spec compliant)
// https://agentskills.io/specification
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

// Skill seen by the agent and the renderer (read-only).
export const ResolvedSkill = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    content: z.string(),
});

export type ResolvedSkill = z.infer<typeof ResolvedSkill>;
