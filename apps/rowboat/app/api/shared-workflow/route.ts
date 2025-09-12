import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Workflow } from '@/app/lib/types/workflow_types';
import { nanoid } from 'nanoid';
import { db } from '@/app/lib/mongodb';
import { SHARED_WORKFLOWS_COLLECTION } from '@/src/infrastructure/repositories/mongodb.shared-workflows.indexes';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

interface SharedWorkflowDoc {
  _id: string;
  workflow: unknown;
  createdAt: Date;
  expiresAt: Date;
}

function validateWorkflowJson(obj: unknown) {
  const parsed = Workflow.safeParse(obj);
  if (!parsed.success) {
    const message = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid workflow JSON: ${message}`);
  }
  return parsed.data;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const url = searchParams.get('url');

    if (id) {
      const coll = db.collection<SharedWorkflowDoc>(SHARED_WORKFLOWS_COLLECTION);
      const doc = await coll.findOne(
        { _id: id },
        { projection: { workflow: 1, expiresAt: 1 } }
      );
      if (!doc) {
        return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
      }
      // Optional safeguard if TTL not yet cleaned up
      if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
      }
      return NextResponse.json(doc.workflow);
    }

    if (!url) {
      return NextResponse.json({ error: 'Missing "id" or "url" query param' }, { status: 400 });
    }

    if (url.startsWith('blob:')) {
      return NextResponse.json({ error: 'Blob URLs are not accessible from the server. Use POST /api/shared-workflow to upload the workflow and share its id.' }, { status: 400 });
    }

    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    if (!isHttp) {
      return NextResponse.json({ error: 'Only http(s) URLs are supported in the "url" param' }, { status: 400 });
    }

    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${resp.status} ${resp.statusText}` }, { status: 400 });
    }
    const text = await resp.text();
    const obj = JSON.parse(text);
    const workflow = validateWorkflowJson(obj);
    return NextResponse.json(workflow);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let body: any;
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else {
      const text = await req.text();
      body = JSON.parse(text);
    }

    const workflowCandidate = typeof body?.workflow === 'object' ? body.workflow : body;
    const workflow = validateWorkflowJson(workflowCandidate);
    const id = nanoid();
    const coll = db.collection<SharedWorkflowDoc>(SHARED_WORKFLOWS_COLLECTION);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_TTL_SECONDS * 1000);
    await coll.insertOne({ _id: id, workflow, createdAt: now, expiresAt });

    const origin = new URL(req.url).origin;
    const href = `${origin}/api/shared-workflow?id=${id}`;
    return NextResponse.json({ id, href, ttlSeconds: DEFAULT_TTL_SECONDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
