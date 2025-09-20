"use server";

import { z } from "zod";
import { nanoid } from "nanoid";
import { Workflow } from "@/app/lib/types/workflow_types";
import { db } from "@/app/lib/mongodb";
import { SHARED_WORKFLOWS_COLLECTION } from "@/src/infrastructure/repositories/mongodb.shared-workflows.indexes";
import { requireAuth } from "@/app/lib/auth";

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

export async function createSharedWorkflowFromJson(json: string): Promise<{ id: string; ttlSeconds: number; }>
{
  // Require an authenticated user (respects guest mode when auth is disabled)
  await requireAuth();
  const obj = JSON.parse(json);
  const workflow = validateWorkflowJson(obj);

  const coll = db.collection<SharedWorkflowDoc>(SHARED_WORKFLOWS_COLLECTION);
  const id = nanoid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_SECONDS * 1000);
  await coll.insertOne({ _id: id, workflow, createdAt: now, expiresAt });

  return { id, ttlSeconds: DEFAULT_TTL_SECONDS };
}

/**
 * Load a shared workflow by ephemeral share id stored in MongoDB.
 * Expected when the query param `shared` is present in the UI.
 */
export async function loadSharedWorkflow(id: string): Promise<z.infer<typeof Workflow>> {
  // Ensure caller is authenticated (guest allowed when auth disabled)
  await requireAuth();

  // Look up by shared id in MongoDB
  const coll = db.collection<SharedWorkflowDoc>(SHARED_WORKFLOWS_COLLECTION);
  const doc = await coll.findOne(
    { _id: id },
    { projection: { workflow: 1, expiresAt: 1 } }
  );
  if (!doc) {
    throw new Error('Not found or expired');
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    throw new Error('Not found or expired');
  }
  return validateWorkflowJson(doc.workflow);
}
