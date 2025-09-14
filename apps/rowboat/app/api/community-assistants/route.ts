import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MongoDBCommunityAssistantsRepository } from '@/src/infrastructure/repositories/mongodb.community-assistants.repository';
import { CommunityAssistant } from '@/src/entities/models/community-assistant';
import { authCheck } from '@/app/actions/auth.actions';
import { auth0 } from '@/app/lib/auth0';
import { USE_AUTH } from '@/app/lib/feature_flags';

const communityAssistantsRepo = new MongoDBCommunityAssistantsRepository();

// Schema for creating a community assistant
const CreateCommunityAssistantSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    category: z.string().min(1),
    tags: z.array(z.string()).max(10),
    isAnonymous: z.boolean().default(false),
    workflow: z.any(), // Will be validated against Workflow schema
    copilotPrompt: z.string().optional(),
    thumbnailUrl: z.string().url().optional(),
    estimatedComplexity: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
});

// Schema for listing community assistants
const ListCommunityAssistantsSchema = z.object({
    category: z.string().optional(),
    search: z.string().optional(),
    featured: z.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
});

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const params = ListCommunityAssistantsSchema.parse({
            category: searchParams.get('category') || undefined,
            search: searchParams.get('search') || undefined,
            featured: searchParams.get('featured') ? searchParams.get('featured') === 'true' : undefined,
            cursor: searchParams.get('cursor') || undefined,
            limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
        });

        const result = await communityAssistantsRepo.list({
            category: params.category,
            search: params.search,
            featured: params.featured,
            isPublic: true, // Only show public assistants
        }, params.cursor, params.limit);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error listing community assistants:', error);
        return NextResponse.json(
            { error: 'Failed to list community assistants' },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        // Get authenticated user
        let user;
        if (USE_AUTH) {
            user = await authCheck();
        } else {
            // For development/testing without auth
            user = { id: 'guest', email: 'guest@example.com' };
        }

        const body = await req.json();
        const data = CreateCommunityAssistantSchema.parse(body);

        // Get user display name from Auth0 session
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

        // Override with user choice
        if (!data.isAnonymous) {
            authorName = data.isAnonymous ? 'Anonymous' : authorName;
        } else {
            authorName = 'Anonymous';
            authorEmail = undefined;
        }

        const communityAssistant = await communityAssistantsRepo.create({
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
            estimatedComplexity: data.estimatedComplexity,
            publishedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            downloadCount: 0,
            likeCount: 0,
            featured: false,
            isPublic: true,
            likes: [],
        });

        return NextResponse.json(communityAssistant);
    } catch (error) {
        console.error('Error creating community assistant:', error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: 'Invalid request data', details: error.errors },
                { status: 400 }
            );
        }
        return NextResponse.json(
            { error: 'Failed to create community assistant' },
            { status: 500 }
        );
    }
}
