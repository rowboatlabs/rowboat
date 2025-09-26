"use server";
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';

export async function getUploadUrlForImage(mimeType: string): Promise<{ id: string; key: string; uploadUrl: string; url: string; mimeType: string }> {
  // Enforce auth in server action context (supports guest mode when auth disabled)
  if (USE_AUTH) {
    await authCheck();
  }

  if (!mimeType || typeof mimeType !== 'string') {
    throw new Error('mimeType is required');
  }

  const bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
  if (!bucket) {
    throw new Error('S3 bucket not configured');
  }

  const ext = mimeType === 'image/jpeg' ? '.jpg'
    : mimeType === 'image/webp' ? '.webp'
    : mimeType === 'image/png' ? '.png'
    : '.bin';

  const id = crypto.randomUUID();
  const idWithExt = `${id}${ext}`;
  const last2 = id.slice(-2).padStart(2, '0');
  const dirA = last2.charAt(0);
  const dirB = last2.charAt(1);
  const key = `uploaded_images/${dirA}/${dirB}/${idWithExt}`;

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

  return { id: idWithExt, key, uploadUrl, url: `/api/uploaded-images/${idWithExt}`, mimeType };
}
