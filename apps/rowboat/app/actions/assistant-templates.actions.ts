"use server";

import { z } from 'zod';
import { authCheck } from "./auth.actions";
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';
import { prebuiltTemplates } from '@/app/lib/prebuilt-cards';
import { USE_AUTH } from '@/app/lib/feature_flags';
// import { ensureLibraryTemplatesSeeded } from '@/app/lib/assistant_templates_seed';

const repo = new MongoDBAssistantTemplatesRepository();

// Helper function to serialize MongoDB objects for client components
function serializeTemplate(template: any) {
    return JSON.parse(JSON.stringify(template));
}

function serializeTemplates(templates: any[]) {
    return templates.map(serializeTemplate);
}

const ListTemplatesSchema = z.object({
    category: z.string().optional(),
    search: z.string().optional(),
    featured: z.boolean().optional(),
    source: z.enum(['library','community']).optional(),
    cursor: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
});

const CreateTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    category: z.string().min(1),
    tags: z.array(z.string()).max(10),
    isAnonymous: z.boolean().default(false),
    workflow: z.any(),
    copilotPrompt: z.string().optional(),
    thumbnailUrl: z.string().url().optional(),
});

type ListResponse = { items: any[]; nextCursor: string | null };

function buildPrebuiltList(params: z.infer<typeof ListTemplatesSchema>): ListResponse {
    const allPrebuilt = Object.entries(prebuiltTemplates).map(([key, tpl]) => ({
        id: `prebuilt:${key}`,
        name: (tpl as any).name || key,
        description: (tpl as any).description || '',
        category: (tpl as any).category || 'Other',
        tools: (tpl as any).tools || [],
        createdAt: (tpl as any).lastUpdatedAt || undefined,
        source: 'library' as const,
    }));

    let filtered = allPrebuilt;
    if (params.category) {
        filtered = filtered.filter(t => t.category === params.category);
    }
    if (params.search) {
        const q = params.search.toLowerCase();
        filtered = filtered.filter(t =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q)
        );
    }

    const startIndex = params.cursor ? parseInt(params.cursor, 10) || 0 : 0;
    const endIndex = Math.min(startIndex + params.limit, filtered.length);
    const pageItems = filtered.slice(startIndex, endIndex);
    const nextCursor = endIndex < filtered.length ? String(endIndex) : null;

    return { items: pageItems, nextCursor };
}

export async function listAssistantTemplates(request: z.infer<typeof ListTemplatesSchema>): Promise<ListResponse> {
    const user = await authCheck();
    
    // Prebuilt templates should never be seeded to DB
    
    const params = ListTemplatesSchema.parse(request);

    // If source specified, return that subset; for 'library' use in-memory prebuilt from code
    if (params.source === 'library') {
        const { items, nextCursor } = buildPrebuiltList(params);
        return { items: serializeTemplates(items), nextCursor };
    }

    if (params.source === 'community') {
        const result = await repo.list({
            category: params.category,
            search: params.search,
            featured: params.featured,
            isPublic: true,
            source: 'community',
        }, params.cursor, params.limit);

        const itemsWithLikeStatus = await addLikeStatusToTemplates(result.items, user.id);
        return { ...result, items: serializeTemplates(itemsWithLikeStatus) };
    }

    // No source: return prebuilt from code + first page of community from DB
    const prebuilt = buildPrebuiltList({ ...params, source: 'library' } as any).items;
    const communityPage = await repo.list({
        category: params.category,
        search: params.search,
        featured: params.featured,
        isPublic: true,
        source: 'community',
    }, undefined, params.limit);
    const items = [...prebuilt, ...communityPage.items];
    return { items: serializeTemplates(items), nextCursor: null };
}

// Get a specific template by ID with model transformation
export async function getAssistantTemplate(templateId: string) {
    const user = await authCheck();
    
    // Prebuilt: load directly from code
    if (templateId.startsWith('prebuilt:')) {
        const key = templateId.replace('prebuilt:', '');
        const originalTemplate = prebuiltTemplates[key as keyof typeof prebuiltTemplates];
        if (!originalTemplate) throw new Error('Template not found');

        const defaultModel = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4.1';
        const transformedWorkflow = JSON.parse(JSON.stringify(originalTemplate));
        if (transformedWorkflow.agents && Array.isArray(transformedWorkflow.agents)) {
            transformedWorkflow.agents.forEach((agent: any) => {
                if (agent.model === '') {
                    agent.model = defaultModel;
                }
            });
        }

        // Return minimal shape expected by callers
        const result = {
            id: templateId,
            name: (originalTemplate as any).name || key,
            description: (originalTemplate as any).description || '',
            category: (originalTemplate as any).category || 'Other',
            workflow: transformedWorkflow,
            source: 'library' as const,
        };
        return serializeTemplate(result);
    }

    // Community template from DB
    const template = await repo.fetch(templateId);
    if (!template) throw new Error('Template not found');
    return serializeTemplate(template);
}

export async function getAssistantTemplateCategories() {
    const user = await authCheck();
    
    const categories = await repo.getCategories();
    return { items: categories };
}


export async function createAssistantTemplate(data: z.infer<typeof CreateTemplateSchema>) {
    const user = await authCheck();
    
    const validatedData = CreateTemplateSchema.parse(data);

    let authorName = 'Anonymous';
    let authorEmail: string | undefined;
    
    if (USE_AUTH) {
        try {
            const { auth0 } = await import('@/app/lib/auth0');
            const { user: auth0User } = await auth0.getSession() || {};
            if (auth0User) {
                authorName = auth0User.name ?? auth0User.email ?? 'Anonymous';
                authorEmail = auth0User.email;
            }
        } catch (error) {
            console.warn('Could not get Auth0 user info:', error);
        }
    }

    if (validatedData.isAnonymous) {
        authorName = 'Anonymous';
        authorEmail = undefined;
    }

    const created = await repo.create({
        name: validatedData.name,
        description: validatedData.description,
        category: validatedData.category,
        authorId: user.id,
        authorName,
        authorEmail,
        isAnonymous: validatedData.isAnonymous,
        workflow: validatedData.workflow,
        tags: validatedData.tags,
        copilotPrompt: validatedData.copilotPrompt,
        thumbnailUrl: validatedData.thumbnailUrl,
        downloadCount: 0,
        likeCount: 0,
        featured: false,
        isPublic: true,
        likes: [],
        source: 'community',
    });

    return serializeTemplate(created);
}

export async function deleteAssistantTemplate(id: string) {
    const user = await authCheck();
    
    const item = await repo.fetch(id);
    if (!item) {
        throw new Error('Template not found');
    }

    // Disallow deleting library/prebuilt items
    if ((item as any).source === 'library' || item.authorId === 'rowboat-system') {
        throw new Error('Not allowed to delete this template');
    }

    if (item.authorId !== user.id) {
        // Do not reveal existence
        throw new Error('Template not found');
    }

    const ok = await repo.deleteByIdAndAuthor(id, user.id);
    if (!ok) {
        throw new Error('Template not found');
    }

    return { success: true };
}

export async function toggleTemplateLike(id: string) {
    const user = await authCheck();
    
    // Use authenticated user ID instead of guest ID
    const result = await repo.toggleLike(id, user.id);
    return serializeTemplate(result);
}

export async function getCurrentUser() {
    const user = await authCheck();
    return { id: user.id };
}

// Helper function to add isLiked status to templates
async function addLikeStatusToTemplates(templates: any[], userId: string) {
    if (templates.length === 0) return templates;
    
    // Get all template IDs
    const templateIds = templates.map(t => t.id);
    
    // Check which templates the user has liked
    const likedTemplates = await repo.getLikedTemplates(templateIds, userId);
    const likedSet = new Set(likedTemplates);
    
    // Add isLiked property to each template
    return templates.map(template => ({
        ...template,
        isLiked: likedSet.has(template.id)
    }));
}
