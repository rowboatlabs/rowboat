import { IndexDescription } from "mongodb";

export const COMMUNITY_ASSISTANTS_COLLECTION = "community_assistants";
export const COMMUNITY_ASSISTANT_LIKES_COLLECTION = "community_assistant_likes";

export const COMMUNITY_ASSISTANTS_INDEXES: IndexDescription[] = [
    { key: { category: 1, publishedAt: -1 }, name: "category_publishedAt" },
    { key: { tags: 1 }, name: "tags" },
    { key: { authorId: 1 }, name: "authorId" },
    { key: { isPublic: 1, featured: 1, publishedAt: -1 }, name: "isPublic_featured_publishedAt" },
    { key: { name: "text", description: "text", tags: "text" }, name: "text_search" },
    { key: { publishedAt: -1 }, name: "publishedAt_desc" },
    { key: { likeCount: -1 }, name: "likeCount_desc" },
    { key: { downloadCount: -1 }, name: "downloadCount_desc" },
];

export const COMMUNITY_ASSISTANT_LIKES_INDEXES: IndexDescription[] = [
    { key: { assistantId: 1, userId: 1 }, name: "assistantId_userId", unique: true },
    { key: { assistantId: 1 }, name: "assistantId" },
    { key: { userId: 1 }, name: "userId" },
    { key: { createdAt: -1 }, name: "createdAt_desc" },
];
