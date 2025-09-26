import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';

// Serves uploaded images from S3 by UUID-only path: /api/uploaded-images/{id}
// Reconstructs the S3 key using the same sharding logic as image upload.
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  // Require authentication if enabled
  try {
    if (USE_AUTH) {
      await authCheck();
    }
  } catch (_) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await props.params;
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
  if (!bucket) {
    return NextResponse.json({ error: 'S3 bucket not configured' }, { status: 500 });
  }

  const region = process.env.RAG_UPLOADS_S3_REGION || 'us-east-1';
  const s3 = new S3Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    } as any : undefined,
  });

  // Reconstruct directory sharding from last two characters of UUID
  const last2 = id.slice(-2).padStart(2, '0');
  const dirA = last2.charAt(0);
  const dirB = last2.charAt(1);
  const baseKey = `uploaded_images/${dirA}/${dirB}/${id}`;

  // Try known extensions in order
  const exts = ['.png', '.jpg', '.webp', '.bin'];
  let foundExt: string | null = null;
  for (const ext of exts) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `${baseKey}${ext}` }));
      foundExt = ext;
      break;
    } catch {
      // continue
    }
  }

  if (!foundExt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const key = `${baseKey}${foundExt}`;
  const filename = `${id}${foundExt}`;
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const contentType = resp.ContentType || 'application/octet-stream';
    const body = resp.Body as any;
    const webStream = body?.transformToWebStream
      ? body.transformToWebStream()
      : (Readable as any)?.toWeb
        ? (Readable as any).toWeb(body)
        : body;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error('S3 get error', e);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
