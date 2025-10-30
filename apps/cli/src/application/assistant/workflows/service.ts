import { z } from "zod";
import { Workflow } from "../../entities/workflow.js";
import { deleteJson, listJson, readJson, writeJson } from "../services/storage.js";

export type WorkflowId = string;

export function listWorkflows(): WorkflowId[] {
  return listJson("workflows");
}

export function getWorkflow(id: WorkflowId): z.infer<typeof Workflow> | undefined {
  const raw = readJson<unknown>("workflows", id);
  if (!raw) return undefined;
  return Workflow.parse(raw);
}

export function upsertWorkflow(
  id: WorkflowId,
  value: Partial<z.infer<typeof Workflow>>
): z.infer<typeof Workflow> {
  const existing = readJson<unknown>("workflows", id) as Partial<z.infer<typeof Workflow>> | undefined;
  const now = new Date().toISOString();

  const defaults: Partial<z.infer<typeof Workflow>> = {
    name: id,
    description: "",
    steps: [],
    createdAt: existing?.createdAt ?? now,
  };
  const merged = {
    ...defaults,
    ...(existing ?? {}),
    ...value,
    updatedAt: now,
  } satisfies Partial<z.infer<typeof Workflow>>;

  const parsed = Workflow.parse(merged);
  writeJson("workflows", id, parsed);
  return parsed;
}

export function deleteWorkflow(id: WorkflowId): boolean {
  return deleteJson("workflows", id);
}
