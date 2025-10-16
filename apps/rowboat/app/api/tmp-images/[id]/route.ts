import { NextRequest, NextResponse } from 'next/server';
import { tempBinaryCache } from '@/src/application/services/temp-binary-cache';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  // Serve from in-memory temp cache
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
