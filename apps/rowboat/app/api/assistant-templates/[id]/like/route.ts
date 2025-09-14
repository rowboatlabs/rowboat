import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MongoDBAssistantTemplatesRepository } from '@/src/infrastructure/repositories/mongodb.assistant-templates.repository';

const repo = new MongoDBAssistantTemplatesRepository();

const ToggleLikeSchema = z.object({
    guestId: z.string().min(1),
});

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        // Prefer header like existing community route
        const guestId = req.headers.get('x-guest-id') || undefined;
        const body = !guestId ? await req.json().catch(() => ({})) : {};
        const parsed = ToggleLikeSchema.safeParse({ guestId: guestId || body.guestId });
        if (!parsed.success) {
            return NextResponse.json({ error: 'Missing guestId' }, { status: 400 });
        }

        const { id } = await context.params;
        const result = await repo.toggleLike(id, parsed.data.guestId);
        return NextResponse.json(result);
    } catch (error) {
        console.error('Error toggling like:', error);
        return NextResponse.json({ error: 'Failed to toggle like' }, { status: 500 });
    }
}


