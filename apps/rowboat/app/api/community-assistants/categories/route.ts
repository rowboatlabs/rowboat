import { NextRequest, NextResponse } from 'next/server';
import { MongoDBCommunityAssistantsRepository } from '@/src/infrastructure/repositories/mongodb.community-assistants.repository';

const communityAssistantsRepo = new MongoDBCommunityAssistantsRepository();

export async function GET(req: NextRequest) {
    try {
        const categories = await communityAssistantsRepo.getCategories();
        
        return NextResponse.json({ categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        return NextResponse.json(
            { error: 'Failed to fetch categories' },
            { status: 500 }
        );
    }
}
