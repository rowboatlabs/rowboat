import { NextRequest, NextResponse } from 'next/server';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';

export async function GET(_req: NextRequest) {
    try {
        let user;
        if (USE_AUTH) {
            user = await authCheck();
        } else {
            user = { id: 'guest_user' } as any;
        }
        return NextResponse.json({ id: user.id });
    } catch (error) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
}


