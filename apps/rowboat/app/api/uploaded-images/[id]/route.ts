import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { requireAuth } from '@/app/lib/auth';

// Serves uploaded images from S3 at path: /api/uploaded-images/{uuid}.{ext}
// Reconstructs the S3 key using the same sharding logic as image upload.
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  // Require authentication (handles guest mode internally when USE_AUTH is disabled)
  await requireAuth();

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

  // Expect id to include extension (e.g., "<uuid>.png")
  const lastDot = id.lastIndexOf('.');
  const idWithoutExt = lastDot > 0 ? id.slice(0, lastDot) : id;
  const filename = id;

  // Reconstruct directory sharding from last two characters of UUID (without extension)
  const last2 = idWithoutExt.slice(-2).padStart(2, '0');
  const dirA = last2.charAt(0);
  const dirB = last2.charAt(1);
  const key = `uploaded_images/${dirA}/${dirB}/${id}`;
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
