import { NextRequest, NextResponse } from 'next/server';
import { MongoDBCommunityAssistantsRepository } from '@/src/infrastructure/repositories/mongodb.community-assistants.repository';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';

const communityAssistantsRepo = new MongoDBCommunityAssistantsRepository();

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        
        const assistant = await communityAssistantsRepo.fetch(id);
        
        if (!assistant) {
            return NextResponse.json(
                { error: 'Community assistant not found' },
                { status: 404 }
            );
        }

        // Only return public assistants
        if (!assistant.isPublic) {
            return NextResponse.json(
                { error: 'Community assistant not found' },
                { status: 404 }
            );
        }

        return NextResponse.json(assistant);
    } catch (error) {
        console.error('Error fetching community assistant:', error);
        return NextResponse.json(
            { error: 'Failed to fetch community assistant' },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Get authenticated user
        let user;
        if (USE_AUTH) {
            user = await authCheck();
        } else {
            // For development/testing without auth
            user = { id: 'guest', email: 'guest@example.com' };
        }

        const { id } = await params;
        const body = await req.json();
        const { action } = body;

        if (action === 'import') {
            // Import the community assistant as a new project
            const assistant = await communityAssistantsRepo.fetch(id);
            
            if (!assistant || !assistant.isPublic) {
                return NextResponse.json(
                    { error: 'Community assistant not found' },
                    { status: 404 }
                );
            }

            // Increment download count
            await communityAssistantsRepo.incrementDownloadCount(id);

            // Return the workflow data for project creation
            return NextResponse.json({
                workflow: assistant.workflow,
                name: assistant.name,
                description: assistant.description,
            });
        }

        return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 }
        );
    } catch (error) {
        console.error('Error processing community assistant action:', error);
        return NextResponse.json(
            { error: 'Failed to process action' },
            { status: 500 }
        );
    }
}
