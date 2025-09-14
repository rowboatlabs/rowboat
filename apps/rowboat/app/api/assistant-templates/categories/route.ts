import { NextRequest, NextResponse } from 'next/server';
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';

const repo = new MongoDBAssistantTemplatesRepository();

export async function GET(_req: NextRequest) {
    try {
        const categories = await repo.getCategories();
        return NextResponse.json({ items: categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
    }
}


