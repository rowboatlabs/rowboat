import { z } from "zod";
import { Agent } from "../../entities/agent.js";
import { deleteJson, listJson, readJson, writeJson } from "../services/storage.js";

export type AgentId = string;

export function listAgents(): AgentId[] {
  return listJson("agents");
}

export function getAgent(id: AgentId): z.infer<typeof Agent> | undefined {
  const raw = readJson<unknown>("agents", id);
  if (!raw) return undefined;
  return Agent.parse(raw);
}

export function upsertAgent(
  id: AgentId,
  value: Partial<z.infer<typeof Agent>>
): z.infer<typeof Agent> {
  const existing = readJson<unknown>("agents", id) as Partial<z.infer<typeof Agent>> | undefined;
  const merged = {
    name: id,
    model: "openai:gpt-4o-mini",
    description: "",
    instructions: "",
    ...(existing ?? {}),
    ...value,
  } satisfies Partial<z.infer<typeof Agent>>;
  const parsed = Agent.parse(merged);
  writeJson("agents", id, parsed);
  return parsed;
}

export function deleteAgent(id: AgentId): boolean {
  return deleteJson("agents", id);
}
