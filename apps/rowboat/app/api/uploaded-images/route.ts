import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { tempBinaryCache } from '@/src/application/services/temp-binary-cache';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { UsageTracker } from '@/app/lib/billing';
import { logUsage } from '@/app/actions/billing.actions';
import { authCheck } from '@/app/actions/auth.actions';
import { USE_AUTH } from '@/app/lib/feature_flags';

// POST /api/uploaded-images
// Accepts an image file (multipart/form-data, field name: "file")
// Stores it either in S3 (if configured) under uploaded_images/<a>/<b>/<uuid>.<ext>
// or in the in-memory temp cache. Returns a JSON with a URL that the agent can fetch.
export async function POST(request: NextRequest) {
  try {
    // Require authentication if enabled
    try {
      if (USE_AUTH) {
        await authCheck();
      }
    } catch (_) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Optionally describe image with Gemini
    let descriptionMarkdown: string | null = null;
    const usageTracker = new UsageTracker();
    try {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
      if (apiKey) {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const prompt = 'Describe this image in concise, high-quality Markdown. Focus on key objects, text, layout, style, colors, and any notable details. Do not include extra commentary or instructions.';
        const result = await model.generateContent([
          { inlineData: { data: buf.toString('base64'), mimeType: mime } },
          prompt,
        ]);
        const response: any = result.response as any;
        descriptionMarkdown = response?.text?.() || null;

        // Track usage similar to agents-runtime
        try {
          const inputTokens = response?.usageMetadata?.promptTokenCount || 0;
          const outputTokens = response?.usageMetadata?.candidatesTokenCount || 0;
          usageTracker.track({
            type: 'LLM_USAGE',
            modelName: 'gemini-2.5-flash',
            inputTokens,
            outputTokens,
            context: 'uploaded_images.upload_with_description',
          });
        } catch (_) {
          // ignore usage tracking errors
        }
      }
    } catch (e) {
      console.warn('Gemini description failed', e);
    }

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

      // Log usage to billing if available
      try {
        const items = usageTracker.flush();
        if (items.length > 0) {
          await logUsage({ items });
        }
      } catch (_) {
        // ignore billing logging errors
      }

      return NextResponse.json({ url, storage: 's3', id: imageId, mimeType: mime, description: descriptionMarkdown });
    }

    // Otherwise store in temp cache and return temp URL
    const ttlSec = 10 * 60; // 10 minutes
    const id = tempBinaryCache.put(buf, mime, ttlSec * 1000);
    const url = `/api/tmp-images/${id}`;
    // Log usage to billing if available
    try {
      const items = usageTracker.flush();
      if (items.length > 0) {
        await logUsage({ items });
      }
    } catch (_) {
      // ignore billing logging errors
    }

    return NextResponse.json({ url, storage: 'temp', id, mimeType: mime, expiresInSec: ttlSec, description: descriptionMarkdown });
  } catch (e) {
    console.error('upload image error', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
