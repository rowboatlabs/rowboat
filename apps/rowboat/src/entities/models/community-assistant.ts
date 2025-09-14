import { z } from "zod";
import { Workflow } from "../../../app/lib/types/workflow_types";

export const CommunityAssistant = z.object({
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
    likes: z.array(z.string()).default([]), // Array of user IDs who liked it
    // Template-like metadata
    copilotPrompt: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    estimatedComplexity: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
});

export type CommunityAssistant = z.infer<typeof CommunityAssistant>;

export const CommunityAssistantLike = z.object({
    id: z.string(),
    assistantId: z.string(),
    userId: z.string(), // Can be guest ID for anonymous users
    userEmail: z.string().optional(), // For logged-in users
    createdAt: z.string().datetime(),
});

export type CommunityAssistantLike = z.infer<typeof CommunityAssistantLike>;
