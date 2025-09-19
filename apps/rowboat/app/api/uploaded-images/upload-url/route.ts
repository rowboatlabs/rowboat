import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
    if (!bucket) {
      return NextResponse.json({ error: 'S3 bucket not configured' }, { status: 500 });
    }

    const { mimeType } = await request.json();
    if (!mimeType || typeof mimeType !== 'string') {
      return NextResponse.json({ error: 'mimeType is required' }, { status: 400 });
    }

    const ext = mimeType === 'image/jpeg' ? '.jpg'
      : mimeType === 'image/webp' ? '.webp'
      : mimeType === 'image/png' ? '.png'
      : '.bin';

    const id = crypto.randomUUID();
    const last2 = id.slice(-2).padStart(2, '0');
    const dirA = last2.charAt(0);
    const dirB = last2.charAt(1);
    const key = `uploaded_images/${dirA}/${dirB}/${id}${ext}`;

    const region = process.env.RAG_UPLOADS_S3_REGION || 'us-east-1';
    const s3 = new S3Client({
      region,
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      } : undefined,
    });

    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });

    return NextResponse.json({ id, key, uploadUrl, url: `/api/uploaded-images/${id}`, mimeType });
  } catch (e) {
    console.error('upload-url error', e);
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }
}

