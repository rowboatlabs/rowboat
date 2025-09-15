import { NextRequest, NextResponse } from 'next/server';
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';

const repo = new MongoDBAssistantTemplatesRepository();

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const item = await repo.fetch(id);
        if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(item);
    } catch (error) {
        console.error('Error fetching assistant template:', error);
        return NextResponse.json({ error: 'Failed to fetch assistant template' }, { status: 500 });
    }
}


