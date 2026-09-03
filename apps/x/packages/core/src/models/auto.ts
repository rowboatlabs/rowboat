import fs from "fs/promises";
import path from "path";
import z from "zod";
import {
    ModelSelection as ModelSelectionSchema,
    ReasoningEffort,
    type TaskModelKey,
} from "@x/shared/dist/models.js";
import {
    normalizeModelRecommendation,
    type RecommendedModelChoice,
} from "@x/shared/dist/rowboat-account.js";
import { WorkDir } from "../config/config.js";
import { getRowboatConfig } from "../config/rowboat.js";
import { capture } from "../analytics/posthog.js";
import container from "../di/container.js";
import { IModelConfigRepo } from "./repo.js";
import { listProviderModelIds } from "./catalog.js";

type ModelSelection = z.infer<typeof ModelSelectionSchema>;

/**
 * Resolution of the Auto sentinel ({ provider, model: "auto" }) into a
 * concrete model. Called from the selection funnels in defaults.ts and from
 * run creation — never below them, so a resolved model is pinned before
 * anything provider-facing runs (createLanguageModel refuses the sentinel
 * outright as the last line of defense).
 *
 * Auto is provider-scoped: the provider on the sentinel is real and is
 * never switched here; only the model is chosen, in this order —
 *
 *   1. The provider flavor's recommendation from /v1/config, task-specific
 *      slot first when resolving a task category, then the assistant slot —
 *      each applied only when the provider's live catalog actually lists it
 *      (a stale recommendation must degrade, not 403/error every request).
 *   2. The last resolution this process line persisted (stability when the
 *      recommendation rotates to something the catalog doesn't serve yet,
 *      and the only option while offline with an unlistable provider).
 *   3. The first model the provider lists (the same last-resort rule as
 *      initial selection).
 *
 * Concrete user selections never reach this module: the funnels only
 * resolve entries that carry the sentinel.
 */
export type AutoCategory = "assistant" | TaskModelKey;

// One remembered resolution per provider+category, persisted so an offline
// start resolves Auto to what it resolved to last time instead of erroring.
const CachedResolution = z.object({
    model: z.string(),
    effort: ReasoningEffort.optional(),
});
const ResolutionCacheFile = z.record(z.string(), CachedResolution);
type ResolutionCache = z.infer<typeof ResolutionCacheFile>;

const cachePath = path.join(WorkDir, "config", "auto-model-cache.json");

// Loaded once per process; written through on change. Derived state only —
// losing it costs nothing while online.
let resolutionCache: ResolutionCache | null = null;

async function loadResolutionCache(): Promise<ResolutionCache> {
    if (!resolutionCache) {
        try {
            resolutionCache = ResolutionCacheFile.parse(JSON.parse(await fs.readFile(cachePath, "utf8")));
        } catch {
            // Missing, corrupt, or schema-drifted — start empty.
            resolutionCache = {};
        }
    }
    return resolutionCache;
}

async function persistResolutionCache(cache: ResolutionCache): Promise<void> {
    try {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        const tmpPath = `${cachePath}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(cache, null, 2));
        await fs.rename(tmpPath, cachePath);
    } catch (error) {
        console.warn("[models] Could not persist the Auto resolution cache:", error);
    }
}

/**
 * Recommendations are keyed by provider FLAVOR; sentinels carry provider
 * INSTANCE ids. Same lookup rule as resolveProviderConfig: rowboat/codex
 * are their own flavors, everything else reads the providers map.
 */
async function flavorOf(providerId: string): Promise<string> {
    if (providerId === "rowboat" || providerId === "codex") return providerId;
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        const cfg = await repo.getConfig();
        return cfg.providers[providerId]?.flavor ?? providerId;
    } catch {
        return providerId;
    }
}

async function remember(
    key: string,
    choice: { model: string; effort?: z.infer<typeof ReasoningEffort> },
    source: "recommendation" | "cached" | "first_listed",
    providerId: string,
    category: AutoCategory,
): Promise<void> {
    const cache = await loadResolutionCache();
    const previous = cache[key];
    if (previous && previous.model === choice.model && previous.effort === choice.effort) return;
    cache[key] = { model: choice.model, ...(choice.effort ? { effort: choice.effort } : {}) };
    await persistResolutionCache(cache);
    // Change-only, so a recommendation rotation shows up as one event per
    // slot rather than one per run.
    capture("auto_model_resolved", {
        provider: providerId,
        category,
        model: choice.model,
        source,
    });
}

export async function resolveAutoSelection(
    providerId: string,
    category: AutoCategory,
): Promise<ModelSelection> {
    const cacheKey = `${providerId}/${category}`;
    // The catalog's per-provider cache makes this cheap after the first call;
    // an unlistable provider yields [] and the fallback chain takes over.
    const availableIds: string[] = await listProviderModelIds(providerId).catch(() => []);

    const flavor = await flavorOf(providerId);
    const recommendations = (await getRowboatConfig().catch(() => null))?.modelRecommendations;
    const recommendation = normalizeModelRecommendation(recommendations, flavor);
    const candidates: RecommendedModelChoice[] = [];
    if (recommendation) {
        if (category !== "assistant") {
            const taskRecommendation = recommendation.taskModels[category];
            if (taskRecommendation) candidates.push(taskRecommendation);
        }
        candidates.push(recommendation.assistantModel);
    }

    const recommended = candidates.find((c) => availableIds.includes(c.model));
    if (recommended) {
        await remember(cacheKey, recommended, "recommendation", providerId, category);
        return {
            provider: providerId,
            model: recommended.model,
            ...(recommended.effort ? { effort: recommended.effort } : {}),
        };
    }

    const cached = (await loadResolutionCache())[cacheKey];
    if (cached && (availableIds.length === 0 || availableIds.includes(cached.model))) {
        return {
            provider: providerId,
            model: cached.model,
            ...(cached.effort ? { effort: cached.effort } : {}),
        };
    }

    const first = availableIds[0];
    if (first) {
        await remember(cacheKey, { model: first }, "first_listed", providerId, category);
        return { provider: providerId, model: first };
    }

    throw new Error(
        `Unable to resolve the Auto model for provider '${providerId}': no applicable recommendation, cached resolution, or listed model`,
    );
}

// Test-only: drop the in-memory cache so each test starts cold.
export function __resetAutoResolutionForTests(): void {
    resolutionCache = null;
}
