import { z } from "zod";
import { Workflow } from "../../../app/lib/types/workflow_types";

export const AssistantTemplate = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    authorId: z.string(),
    authorName: z.string(),
    authorEmail: z.string().optional(),
    isAnonymous: z.boolean(),
    workflow: Workflow,
    tags: z.array(z.string()),
    publishedAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    downloadCount: z.number().default(0),
    likeCount: z.number().default(0),
    featured: z.boolean().default(false),
    isPublic: z.boolean().default(true),
    // Social features
    likes: z.array(z.string()).default([]),
    // Template-like metadata
    copilotPrompt: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    // New field to indicate source of template
    source: z.enum(["library", "community"]),
});

export type AssistantTemplate = z.infer<typeof AssistantTemplate>;

export const AssistantTemplateLike = z.object({
    id: z.string(),
    assistantId: z.string(),
    userId: z.string(),
    userEmail: z.string().optional(),
    createdAt: z.string().datetime(),
});

export type AssistantTemplateLike = z.infer<typeof AssistantTemplateLike>;


