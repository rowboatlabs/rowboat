import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: NextRequest) {
  try {
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

    const last2 = id.slice(-2).padStart(2, '0');
    const dirA = last2.charAt(0);
    const dirB = last2.charAt(1);
    const baseKey = `uploaded_images/${dirA}/${dirB}/${id}`;
    const exts = ['.png', '.jpg', '.webp', '.bin'];
    let foundExt: string | null = null;
    for (const ext of exts) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `${baseKey}${ext}` }));
        foundExt = ext; break;
      } catch {}
    }
    if (!foundExt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const key = `${baseKey}${foundExt}`;
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
        descriptionMarkdown = result.response?.text?.() || null;
      }
    } catch (e) {
      console.warn('Gemini description failed', e);
    }

    return NextResponse.json({ id, description: descriptionMarkdown });
  } catch (e) {
    console.error('describe error', e);
    return NextResponse.json({ error: 'Failed to describe' }, { status: 500 });
  }
}

