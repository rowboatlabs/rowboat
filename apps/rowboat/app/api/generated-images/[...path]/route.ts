import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export async function GET(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  const path = params.path || [];
  if (path.length < 3) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
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

  const filename = path[path.length - 1];
  const key = `generated_images/${path.join('/')}`;
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
