import { NextRequest, NextResponse } from 'next/server';
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';

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

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const item = await repo.fetch(id);
        if (!item) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // Disallow deleting library/prebuilt items
        if ((item as any).source === 'library' || item.authorId === 'rowboat-system') {
            return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
        }

        let user;
        if (USE_AUTH) {
            user = await authCheck();
        } else {
            user = { id: 'guest_user' } as any; // guest mode acts as a single user
        }

        if (item.authorId !== user.id) {
            // Do not reveal existence
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const ok = await repo.deleteByIdAndAuthor(id, user.id);
        if (!ok) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting assistant template:', error);
        return NextResponse.json({ error: 'Failed to delete assistant template' }, { status: 500 });
    }
}


