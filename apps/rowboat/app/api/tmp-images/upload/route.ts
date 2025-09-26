import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/auth';
import { tempBinaryCache } from '@/src/application/services/temp-binary-cache';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { UsageTracker, getCustomerForUserId, logUsage as libLogUsage } from '@/app/lib/billing';
import { USE_AUTH, USE_BILLING } from '@/app/lib/feature_flags';

// POST /api/tmp-images/upload
// Accepts an image file (multipart/form-data, field name: "file")
// Stores it in the in-memory temp cache and returns a temporary URL.
export async function POST(request: NextRequest) {
  try {
    // Require authentication if enabled
    let currentUser: any | null = null;
    if (USE_AUTH) {
      try {
        currentUser = await requireAuth();
      } catch {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
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

        // Track usage similar to rag-worker
        try {
          const inputTokens = response?.usageMetadata?.promptTokenCount || 0;
          const outputTokens = response?.usageMetadata?.candidatesTokenCount || 0;
          usageTracker.track({
            type: 'LLM_USAGE',
            modelName: 'gemini-2.5-flash',
            inputTokens,
            outputTokens,
            context: 'tmp_images.upload_with_description',
          });
        } catch {
          // ignore usage tracking errors
        }
      }
    } catch (e) {
      console.warn('Gemini description failed', e);
    }

    // Store in temp cache and return temp URL
    const ttlSec = 10 * 60; // 10 minutes
    const id = tempBinaryCache.put(buf, mime, ttlSec * 1000);
    const url = `/api/tmp-images/${id}`;

    // Log usage to billing similar to rag-worker
    try {
      if (USE_BILLING && currentUser) {
        const customer = await getCustomerForUserId(currentUser.id);
        if (customer) {
          const items = usageTracker.flush();
          if (items.length > 0) {
            await libLogUsage(customer.id, { items });
          }
        }
      }
    } catch {
      // ignore billing logging errors
    }

    return NextResponse.json({ url, storage: 'temp', id, mimeType: mime, expiresInSec: ttlSec, description: descriptionMarkdown });
  } catch (e) {
    console.error('tmp image upload error', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

