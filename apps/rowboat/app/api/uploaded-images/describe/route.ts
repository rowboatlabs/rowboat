import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { UsageTracker } from '@/app/lib/billing';
import { logUsage } from '@/app/actions/billing.actions';
import { requireAuth } from '@/app/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Require authentication (handles guest mode internally when auth disabled)
    await requireAuth();

    const { id } = await request.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
    if (!bucket) {
      return NextResponse.json({ error: 'S3 bucket not configured' }, { status: 500 });
    }

    const region = process.env.RAG_UPLOADS_S3_REGION || 'us-east-1';
    const s3 = new S3Client({
      region,
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      } : undefined,
    });

    // `id` includes extension (e.g., "<uuid>.png"). Shard using the UUID part.
    const lastDot = id.lastIndexOf('.');
    const idWithoutExt = lastDot > 0 ? id.slice(0, lastDot) : id;
    const last2 = idWithoutExt.slice(-2).padStart(2, '0');
    const dirA = last2.charAt(0);
    const dirB = last2.charAt(1);
    const key = `uploaded_images/${dirA}/${dirB}/${id}`;
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

        // Track usage similar to agents-runtime
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
        } catch (_) {
          // ignore usage tracking errors
        }
      }
    } catch (e) {
      console.warn('Gemini description failed', e);
    }

    // Log usage to billing if available
    try {
      const items = usageTracker.flush();
      if (items.length > 0) {
        await logUsage({ items });
      }
    } catch (_) {
      // ignore billing logging errors
    }

    return NextResponse.json({ id, description: descriptionMarkdown });
  } catch (e) {
    console.error('describe error', e);
    return NextResponse.json({ error: 'Failed to describe' }, { status: 500 });
  }
}
