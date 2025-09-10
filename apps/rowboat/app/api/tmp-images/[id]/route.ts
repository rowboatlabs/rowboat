import { NextRequest, NextResponse } from 'next/server';
import { tempBinaryCache } from '@/src/application/services/temp-binary-cache';
import { redisBinaryCache } from '@/src/application/services/redis-binary-cache';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  // Try Redis-backed cache first (multi-instance safe)
  const fromRedis = await redisBinaryCache.get(id);
  if (fromRedis) {
    return new NextResponse(fromRedis.buf, {
      status: 200,
      headers: {
        'Content-Type': fromRedis.mimeType || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${id}"`,
      },
    });
  }
  // Fallback to in-memory cache (single-instance dev)
  const entry = tempBinaryCache.get(id);
  if (!entry) {
    return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
  }

  return new NextResponse(entry.buf, {
    status: 200,
    headers: {
      'Content-Type': entry.mimeType || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${id}"`,
    },
  });
}
