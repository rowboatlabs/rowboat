import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';
import { ensureLibraryTemplatesSeeded } from '@/app/lib/assistant_templates_seed';
import { authCheck } from '@/app/actions/auth.actions';
import { auth0 } from '@/app/lib/auth0';
import { USE_AUTH } from '@/app/lib/feature_flags';

const repo = new MongoDBAssistantTemplatesRepository();

const ListSchema = z.object({
    category: z.string().optional(),
    search: z.string().optional(),
    featured: z.boolean().optional(),
    source: z.enum(['library','community']).optional(),
    cursor: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
});

const CreateSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    category: z.string().min(1),
    tags: z.array(z.string()).max(10),
    isAnonymous: z.boolean().default(false),
    workflow: z.any(),
    copilotPrompt: z.string().optional(),
    thumbnailUrl: z.string().url().optional(),
});

export async function GET(req: NextRequest) {
    try {
        // Ensure library JSONs are seeded into the unified collection (idempotent)
        await ensureLibraryTemplatesSeeded();
        const { searchParams } = new URL(req.url);
        const params = ListSchema.parse({
            category: searchParams.get('category') || undefined,
            search: searchParams.get('search') || undefined,
            featured: searchParams.get('featured') ? searchParams.get('featured') === 'true' : undefined,
            source: (searchParams.get('source') as 'library' | 'community') || undefined,
            cursor: searchParams.get('cursor') || undefined,
            limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
        });

        // If source specified, query that subset; otherwise return combined from the unified collection
        if (params.source === 'library' || params.source === 'community') {
            const result = await repo.list({
                category: params.category,
                search: params.search,
                featured: params.featured,
                isPublic: true,
                source: params.source,
            }, params.cursor, params.limit);
            return NextResponse.json(result);
        }

        // No source: combine both subsets from the unified collection
        const [lib, com] = await Promise.all([
            repo.list({ category: params.category, search: params.search, featured: params.featured, isPublic: true, source: 'library' }, undefined, params.limit),
            repo.list({ category: params.category, search: params.search, featured: params.featured, isPublic: true, source: 'community' }, undefined, params.limit),
        ]);
        return NextResponse.json({ items: [...lib.items, ...com.items], nextCursor: null });
    } catch (error) {
        console.error('Error listing assistant templates:', error);
        return NextResponse.json({ error: 'Failed to list assistant templates' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        let user;
        if (USE_AUTH) {
            user = await authCheck();
        } else {
            user = { id: 'guest', email: 'guest@example.com' };
        }

        const body = await req.json();
        const data = CreateSchema.parse(body);

        let authorName = 'Anonymous';
        let authorEmail: string | undefined;
        if (USE_AUTH) {
            try {
                const { user: auth0User } = await auth0.getSession() || {};
                if (auth0User) {
                    authorName = auth0User.name ?? auth0User.email ?? 'Anonymous';
                    authorEmail = auth0User.email;
                }
            } catch (error) {
                console.warn('Could not get Auth0 user info:', error);
            }
        }

        if (data.isAnonymous) {
            authorName = 'Anonymous';
            authorEmail = undefined;
        }

        const created = await repo.create({
            name: data.name,
            description: data.description,
            category: data.category,
            authorId: user.id,
            authorName,
            authorEmail,
            isAnonymous: data.isAnonymous,
            workflow: data.workflow,
            tags: data.tags,
            copilotPrompt: data.copilotPrompt,
            thumbnailUrl: data.thumbnailUrl,
            downloadCount: 0,
            likeCount: 0,
            featured: false,
            isPublic: true,
            likes: [],
            source: 'community',
        });

        return NextResponse.json(created);
    } catch (error) {
        console.error('Error creating assistant template:', error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to create assistant template' }, { status: 500 });
    }
}


