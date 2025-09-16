"use server";

import { z } from 'zod';
import { authCheck } from "./auth.actions";
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';
import { prebuiltTemplates } from '@/app/lib/prebuilt-cards';
import { USE_AUTH } from '@/app/lib/feature_flags';
import { ensureLibraryTemplatesSeeded } from '@/app/lib/assistant_templates_seed';

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

export async function listAssistantTemplates(request: z.infer<typeof ListTemplatesSchema>) {
    const user = await authCheck();
    
    // Kick off best-effort library reconcile/seed on each UI fetch (non-blocking)
    try { void ensureLibraryTemplatesSeeded(); } catch {}
    
    const params = ListTemplatesSchema.parse(request);

    // If source specified, query that subset; otherwise return combined from the unified collection
    if (params.source === 'library' || params.source === 'community') {
        const result = await repo.list({
            category: params.category,
            search: params.search,
            featured: params.featured,
            isPublic: true,
            source: params.source,
        }, params.cursor, params.limit);
        
        // Add isLiked status to each template
        const itemsWithLikeStatus = await addLikeStatusToTemplates(result.items, user.id);
        
        return {
            ...result,
            items: serializeTemplates(itemsWithLikeStatus)
        };
    }

    // No source: combine both subsets from the unified collection
    const [lib, com] = await Promise.all([
        repo.list({ category: params.category, search: params.search, featured: params.featured, isPublic: true, source: 'library' }, undefined, params.limit),
        repo.list({ category: params.category, search: params.search, featured: params.featured, isPublic: true, source: 'community' }, undefined, params.limit),
    ]);
    
    // Add isLiked status to all templates
    const allTemplates = [...lib.items, ...com.items];
    const itemsWithLikeStatus = await addLikeStatusToTemplates(allTemplates, user.id);
    
    return { 
        items: serializeTemplates(itemsWithLikeStatus), 
        nextCursor: null 
    };
}

// Get a specific template by ID with model transformation
export async function getAssistantTemplate(templateId: string) {
    const user = await authCheck();
    
    const template = await repo.fetch(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    // Check if this is a prebuilt template by looking at tags
    const isPrebuiltTemplate = template.tags.some(tag => tag.startsWith('prebuilt:') || tag === '__library__');
    
    if (isPrebuiltTemplate) {
        // For prebuilt templates, get the original JSON and apply fresh transformation
        const prebuiltTag = template.tags.find(tag => tag.startsWith('prebuilt:'));
        if (prebuiltTag) {
            const prebuiltKey = prebuiltTag.replace('prebuilt:', '');
            const originalTemplate = prebuiltTemplates[prebuiltKey as keyof typeof prebuiltTemplates];
            
            if (originalTemplate) {
                // Apply model transformation to the original template
                const defaultModel = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4.1';
                const transformedWorkflow = JSON.parse(JSON.stringify(originalTemplate));
                
                // Transform blank agent models to use the default model
                if (transformedWorkflow.agents && Array.isArray(transformedWorkflow.agents)) {
                    transformedWorkflow.agents.forEach((agent: any) => {
                        if (agent.model === '') {
                            agent.model = defaultModel;
                            console.log(`[PrebuiltTemplate] Applied model ${defaultModel} to agent ${agent.name} in template ${prebuiltKey}`);
                        }
                    });
                }
                
                // Return the transformed template with database metadata but fresh workflow
                const result = {
                    ...template,
                    workflow: transformedWorkflow
                };
                
                return serializeTemplate(result);
            }
        }
    }
    
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
