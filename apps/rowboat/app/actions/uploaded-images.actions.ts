"use server";
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { UsageTracker } from '@/app/lib/billing';
import { logUsage } from '@/app/actions/billing.actions';

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

export async function describeUploadedImage(id: string): Promise<{ id: string; description: string | null }> {
  if (USE_AUTH) {
    await authCheck();
  }

  if (!id || typeof id !== 'string') {
    throw new Error('id is required');
  }

  const bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
  if (!bucket) {
    throw new Error('S3 bucket not configured');
  }

  const region = process.env.RAG_UPLOADS_S3_REGION || 'us-east-1';
  const s3 = new S3Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
    } : undefined,
  });

  const lastDot = id.lastIndexOf('.');
  const idWithoutExt = lastDot > 0 ? id.slice(0, lastDot) : id;
  const last2 = idWithoutExt.slice(-2).padStart(2, '0');
  const dirA = last2.charAt(0);
  const dirB = last2.charAt(1);
  const key = `uploaded_images/${dirA}/${dirB}/${id}`;

  // Fetch object bytes from S3
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const contentType = resp.ContentType || 'application/octet-stream';
  const body = resp.Body as any;
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    body.on('data', (c: Uint8Array) => chunks.push(c));
    body.on('end', () => resolve());
    body.on('error', reject);
  });
  const buf = Buffer.concat(chunks);

  let descriptionMarkdown: string | null = null;
  const usageTracker = new UsageTracker();
  try {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = 'Describe this image in concise, high-quality Markdown. Focus on key objects, text, layout, style, colors, and any notable details. Do not include extra commentary or instructions.';
      const result = await model.generateContent([
        { inlineData: { data: buf.toString('base64'), mimeType: contentType } },
        prompt,
      ]);
      const response: any = result.response as any;
      descriptionMarkdown = response?.text?.() || null;

      // Track usage
      try {
        const inputTokens = response?.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response?.usageMetadata?.candidatesTokenCount || 0;
        usageTracker.track({
          type: 'LLM_USAGE',
          modelName: 'gemini-2.5-flash',
          inputTokens,
          outputTokens,
          context: 'uploaded_images.describe',
        });
      } catch {
        // ignore
      }
    }
  } catch (e) {
    console.warn('Gemini description failed', e);
  }

  // Log usage to billing
  try {
    const items = usageTracker.flush();
    if (items.length > 0) {
      await logUsage({ items });
    }
  } catch {
    // ignore billing logging errors
  }

  return { id, description: descriptionMarkdown };
}
