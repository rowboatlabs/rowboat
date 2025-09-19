import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { tempBinaryCache } from '@/src/application/services/temp-binary-cache';

// POST /api/uploaded-images
// Accepts an image file (multipart/form-data, field name: "file")
// Stores it either in S3 (if configured) under uploaded_images/<a>/<b>/<uuid>.<ext>
// or in the in-memory temp cache. Returns a JSON with a URL that the agent can fetch.
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const mime = file.type || 'application/octet-stream';

    // If S3 configured, upload there
    const s3Bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
    if (s3Bucket) {
      const s3Region = process.env.RAG_UPLOADS_S3_REGION || 'us-east-1';
      const s3 = new S3Client({
        region: s3Region,
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
        } : undefined,
      });

      const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : mime === 'image/png' ? '.png' : '.bin';
      const imageId = crypto.randomUUID();
      const last2 = imageId.slice(-2).padStart(2, '0');
      const dirA = last2.charAt(0);
      const dirB = last2.charAt(1);
      const key = `uploaded_images/${dirA}/${dirB}/${imageId}${ext}`;

      await s3.send(new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: buf,
        ContentType: mime,
      }));

      const url = `/api/uploaded-images/${imageId}`;
      return NextResponse.json({ url, storage: 's3', id: imageId, mimeType: mime });
    }

    // Otherwise store in temp cache and return temp URL
    const ttlSec = 10 * 60; // 10 minutes
    const id = tempBinaryCache.put(buf, mime, ttlSec * 1000);
    const url = `/api/tmp-images/${id}`;
    return NextResponse.json({ url, storage: 'temp', id, mimeType: mime, expiresInSec: ttlSec });
  } catch (e) {
    console.error('upload image error', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

