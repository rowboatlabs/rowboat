import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MongoDBCommunityAssistantsRepository } from '@/src/infrastructure/repositories/mongodb.community-assistants.repository';
import { authCheck } from '@/app/actions/auth.actions';
import { auth0 } from '@/app/lib/auth0';
import { USE_AUTH } from '@/app/lib/feature_flags';

const communityAssistantsRepo = new MongoDBCommunityAssistantsRepository();

const ToggleLikeSchema = z.object({
    liked: z.boolean(),
});

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        
        // Try to parse body, but don't require it for toggle functionality
        let body = {};
        try {
            const text = await req.text();
            if (text) {
                body = JSON.parse(text);
            }
        } catch (error) {
            // If no body or invalid JSON, continue with empty body
        }

        // Get user ID (works for both authenticated and guest users)
        let userId: string;
        let userEmail: string | undefined;

        if (USE_AUTH) {
            try {
                const user = await authCheck();
                userId = user.id;
                userEmail = user.email;
            } catch (error) {
                // If not authenticated, use a consistent guest ID from headers or generate one
                const guestId = req.headers.get('x-guest-id') || `guest-${crypto.randomUUID()}`;
                userId = guestId;
            }
        } else {
            // For development/testing without auth, use a consistent guest ID
            const guestId = req.headers.get('x-guest-id') || `guest-${crypto.randomUUID()}`;
            userId = guestId;
        }

        // Verify the assistant exists and is public
        const assistant = await communityAssistantsRepo.fetch(id);
        if (!assistant || !assistant.isPublic) {
            return NextResponse.json(
                { error: 'Community assistant not found' },
                { status: 404 }
            );
        }

        // Toggle the like
        const result = await communityAssistantsRepo.toggleLike(id, userId, userEmail);

        return NextResponse.json({
            liked: result.liked,
            likeCount: result.likeCount,
        });
    } catch (error) {
        console.error('Error toggling like:', error);
        return NextResponse.json(
            { error: 'Failed to toggle like' },
            { status: 500 }
        );
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get user ID (works for both authenticated and guest users)
        let userId: string;

        if (USE_AUTH) {
            try {
                const user = await authCheck();
                userId = user.id;
            } catch (error) {
                // If not authenticated, generate a guest ID
                userId = `guest-${crypto.randomUUID()}`;
            }
        } else {
            // For development/testing without auth
            userId = `guest-${crypto.randomUUID()}`;
        }

        // Get like count and user's like status
        const [likeCount, userLiked] = await Promise.all([
            communityAssistantsRepo.getLikeCount(id),
            communityAssistantsRepo.getUserLikes(id, userId),
        ]);

        return NextResponse.json({
            likeCount,
            liked: userLiked,
        });
    } catch (error) {
        console.error('Error getting like status:', error);
        return NextResponse.json(
            { error: 'Failed to get like status' },
            { status: 500 }
        );
    }
}
