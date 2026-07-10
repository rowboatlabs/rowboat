import fs from "node:fs/promises";
import path from "node:path";
import z from "zod";
import { WorkDir } from "../config/config.js";

const CACHE_PATH = path.join(WorkDir, "config", "models.dev.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/*
 "claude-opus-4-6": {
    "id": "claude-opus-4-6",
    "name": "Claude Opus 4.6",
    "family": "claude-opus",
    "attachment": true,
    "reasoning": true,
    "tool_call": true,
    "temperature": true,
    "knowledge": "2025-05",
    "release_date": "2026-02-05",
    "last_updated": "2026-03-13",
    "modalities": {
      "input": [
        "text",
        "image",
        "pdf"
      ],
      "output": [
        "text"
      ]
    },
    "open_weights": false,
    "cost": {
      "input": 5,
      "output": 25,
      "cache_read": 0.5,
      "cache_write": 6.25
    },
    "limit": {
      "context": 1000000,
      "output": 128000
    },
    "experimental": {
      "modes": {
        "fast": {
          "cost": {
            "input": 30,
            "output": 150,
            "cache_read": 3,
            "cache_write": 37.5
          },
          "provider": {
            "body": {
              "speed": "fast"
            },
            "headers": {
              "anthropic-beta": "fast-mode-2026-02-01"
            }
          }
        }
      }
    }
  }
*/
const ModelsDevModel = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  tool_call: z.boolean().optional(),
  reasoning: z.boolean().optional(),
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
    // Supports reasoning/extended thinking per models.dev; absent = unknown.
    reasoning?: boolean;
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
      reasoning: model.reasoning,
      status: model.status,
    }))
    .filter((model) => isStableModel(model) && supportsToolCall(model))
    .map(({ id, name, release_date, reasoning }) => ({ id, name, release_date, reasoning }));

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

/**
 * Whether a model supports reasoning/extended thinking, per the models.dev
 * catalog. Reads ONLY the on-disk cache (stale is fine) — this sits on the
 * turn-start path and must never block on the network. Returns undefined
 * when the model or provider is unknown or no cache exists; callers treat
 * unknown as "don't send reasoning parameters" (fail closed).
 *
 * Accepts gateway/OpenRouter-style "vendor/model" ids by splitting on the
 * first slash and matching the vendor against the catalog's providers.
 */
export async function isReasoningModel(
  flavor: string,
  modelId: string,
): Promise<boolean | undefined> {
  let vendor = flavor;
  let id = modelId;
  if ((flavor === "rowboat" || flavor === "openrouter" || flavor === "aigateway") && modelId.includes("/")) {
    const slash = modelId.indexOf("/");
    vendor = modelId.slice(0, slash);
    id = modelId.slice(slash + 1);
  }
  if (vendor !== "openai" && vendor !== "anthropic" && vendor !== "google") {
    return undefined;
  }
  try {
    const cached = await readCache();
    if (!cached) return undefined;
    const parsed = ModelsDevResponse.safeParse(cached.data);
    if (!parsed.success) return undefined;
    const provider = pickProvider(parsed.data, vendor);
    if (!provider) return undefined;
    for (const [key, model] of Object.entries(provider.models)) {
      if ((model.id ?? key) === id) {
        return model.reasoning === true;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Annotate gateway-style "vendor/model" ids with the models.dev reasoning
 * flag. Reads the cache once for the whole batch; ids whose vendor or model
 * is unknown keep `reasoning` absent (= unknown). Cache-only, like
 * isReasoningModel.
 */
export async function annotateReasoningFlags<T extends { id: string }>(
  models: T[],
): Promise<Array<T & { reasoning?: boolean }>> {
  let catalog: z.infer<typeof ModelsDevResponse> | null = null;
  try {
    const cached = await readCache();
    if (cached) {
      const parsed = ModelsDevResponse.safeParse(cached.data);
      if (parsed.success) catalog = parsed.data;
    }
  } catch {
    catalog = null;
  }
  if (!catalog) return models;

  const flags = new Map<string, boolean>();
  for (const vendor of ["openai", "anthropic", "google"] as const) {
    const provider = pickProvider(catalog, vendor);
    if (!provider) continue;
    for (const [key, model] of Object.entries(provider.models)) {
      if (typeof model.reasoning === "boolean") {
        flags.set(`${vendor}/${model.id ?? key}`, model.reasoning);
      }
    }
  }

  return models.map((model) => {
    const reasoning = flags.get(model.id);
    return reasoning === undefined ? model : { ...model, reasoning };
  });
}

export async function getChatModelIds(
  flavor: "openai" | "anthropic" | "google",
): Promise<Set<string>> {
  try {
    const { data } = await getModelsDevData();
    const provider = pickProvider(data, flavor);
    if (!provider) return new Set();
    const ids = new Set<string>();
    for (const [id, model] of Object.entries(provider.models)) {
      if (isStableModel(model) && supportsToolCall(model)) {
        ids.add(model.id ?? id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}
