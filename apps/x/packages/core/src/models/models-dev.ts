import fs from "node:fs/promises";
import path from "node:path";
import z from "zod";
import { WorkDir } from "../config/config.js";

const CACHE_PATH = path.join(WorkDir, "config", "models.dev.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const ModelsDevModel = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  tool_call: z.boolean().optional(),
  experimental: z.boolean().optional(),
  status: z.enum(["alpha", "beta", "deprecated"]).optional(),
}).passthrough();

const ModelsDevProvider = z.object({
  id: z.string().optional(),
  name: z.string(),
  models: z.record(z.string(), ModelsDevModel),
}).passthrough();

const ModelsDevResponse = z.record(z.string(), ModelsDevProvider);

type ProviderSummary = {
  id: string;
  name: string;
  models: Array<{
    id: string;
    name?: string;
    release_date?: string;
  }>;
};

type CacheFile = {
  fetchedAt: string;
  data: unknown;
};

async function readCache(): Promise<CacheFile | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

async function writeCache(data: unknown): Promise<void> {
  const payload: CacheFile = {
    fetchedAt: new Date().toISOString(),
    data,
  };
  await fs.writeFile(CACHE_PATH, JSON.stringify(payload, null, 2));
}

async function fetchModelsDev(): Promise<unknown> {
  const response = await fetch("https://models.dev/api.json", {
    headers: { "User-Agent": "Rowboat" },
  });
  if (!response.ok) {
    throw new Error(`models.dev fetch failed: ${response.status}`);
  }
  return response.json();
}

function isCacheFresh(fetchedAt: string): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

async function getModelsDevData(): Promise<{ data: z.infer<typeof ModelsDevResponse>; fetchedAt?: string }> {
  const cached = await readCache();
  if (cached?.fetchedAt && isCacheFresh(cached.fetchedAt)) {
    const parsed = ModelsDevResponse.safeParse(cached.data);
    if (parsed.success) {
      return { data: parsed.data, fetchedAt: cached.fetchedAt };
    }
  }

  try {
    const fresh = await fetchModelsDev();
    const parsed = ModelsDevResponse.parse(fresh);
    await writeCache(parsed);
    return { data: parsed, fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (cached) {
      const parsed = ModelsDevResponse.safeParse(cached.data);
      if (parsed.success) {
        return { data: parsed.data, fetchedAt: cached.fetchedAt };
      }
    }
    throw error;
  }
}

function scoreProvider(flavor: string, id: string, name: string): number {
  const normalizedId = id.toLowerCase();
  const normalizedName = name.toLowerCase();
  let score = 0;
  if (normalizedId === flavor) score += 100;
  if (normalizedName.includes(flavor)) score += 20;
  if (flavor === "google") {
    if (normalizedName.includes("gemini")) score += 10;
    if (normalizedName.includes("vertex")) score -= 5;
  }
  return score;
}

function pickProvider(
  data: z.infer<typeof ModelsDevResponse>,
  flavor: "openai" | "anthropic" | "google",
): z.infer<typeof ModelsDevProvider> | null {
  if (data[flavor]) return data[flavor];
  let best: { score: number; provider: z.infer<typeof ModelsDevProvider> } | null = null;
  for (const [id, provider] of Object.entries(data)) {
    const s = scoreProvider(flavor, id, provider.name);
    if (s <= 0) continue;
    if (!best || s > best.score) {
      best = { score: s, provider };
    }
  }
  return best?.provider ?? null;
}

function isStableModel(model: z.infer<typeof ModelsDevModel>): boolean {
  if (model.experimental) return false;
  if (model.status && ["alpha", "beta", "deprecated"].includes(model.status)) return false;
  return true;
}

function supportsToolCall(model: z.infer<typeof ModelsDevModel>): boolean {
  return model.tool_call === true;
}

function normalizeModels(models: Record<string, z.infer<typeof ModelsDevModel>>): ProviderSummary["models"] {
  const list = Object.entries(models)
    .map(([id, model]) => ({
      id: model.id ?? id,
      name: model.name,
      release_date: model.release_date,
      tool_call: model.tool_call,
      experimental: model.experimental,
      status: model.status,
    }))
    .filter((model) => isStableModel(model) && supportsToolCall(model))
    .map(({ id, name, release_date }) => ({ id, name, release_date }));

  list.sort((a, b) => {
    const aDate = a.release_date ? Date.parse(a.release_date) : 0;
    const bDate = b.release_date ? Date.parse(b.release_date) : 0;
    return bDate - aDate;
  });
  return list;
}

export async function listOnboardingModels(): Promise<{ providers: ProviderSummary[]; lastUpdated?: string }> {
  const { data, fetchedAt } = await getModelsDevData();
  const providers: ProviderSummary[] = [];
  const flavors: Array<"openai" | "anthropic" | "google"> = ["openai", "anthropic", "google"];

  for (const flavor of flavors) {
    const provider = pickProvider(data, flavor);
    if (!provider) continue;
    providers.push({
      id: flavor,
      name: provider.name,
      models: normalizeModels(provider.models),
    });
  }

  return { providers, lastUpdated: fetchedAt };
}
