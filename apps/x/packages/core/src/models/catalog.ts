import z from "zod";
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";
import { isSignedIn } from "../account/account.js";
import { getChatGPTStatus } from "../auth/chatgpt-auth.js";
import container from "../di/container.js";
import { IModelConfigRepo } from "./repo.js";
import { listGatewayModels } from "./gateway.js";
import { listCodexModels } from "./codex.js";
import { listModelsForProvider } from "./models.js";
import { listOnboardingModels } from "./models-dev.js";
import { getDefaultModelAndProvider } from "./defaults.js";

/**
 * The unified model catalog: one function that answers "which providers are
 * connected and what models does each offer", treating every provider the
 * same way — the Rowboat gateway, the ChatGPT subscription (codex), BYOK
 * cloud keys, and local/custom endpoints are all just providers. The
 * per-provider listing mechanics (which endpoint, which fallback) live here
 * and nowhere else; the renderer consumes this through the single models:list
 * IPC call.
 */

export interface CatalogModelEntry {
    id: string;
    name?: string;
    /** models.dev "supports reasoning" flag; absent = unknown. */
    reasoning?: boolean;
}

export interface CatalogProviderEntry {
    /**
     * Provider INSTANCE identifier — what ModelRef.provider, defaultSelection,
     * task overrides, and refreshProvider all reference. Today one instance
     * exists per flavor, so id always equals the flavor key ("openai",
     * "ollama", "rowboat", …); a future multi-key setup ("openai-work" /
     * "openai-personal") would yield two entries with distinct ids sharing
     * one flavor, without changing what an id means anywhere.
     */
    id: string;
    /** Provider TYPE ("openai", "ollama", …, "rowboat", "codex") — drives
     * display naming, listing mechanics, and credential-field UI. */
    flavor: string;
    /** "error" = the provider is connected but its model list failed to load. */
    status: "ok" | "error";
    error?: string;
    /** The provider's saved default model from models.json, if any. */
    savedModel?: string;
    models: CatalogModelEntry[];
}

export interface ModelCatalogResult {
    providers: CatalogProviderEntry[];
    /** The effective runtime default (what runs when nothing is picked). */
    defaultModel: { provider: string; model: string } | null;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    rowboat: "Rowboat",
    codex: "OpenAI Codex",
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Gemini",
    openrouter: "OpenRouter",
    aigateway: "AI Gateway",
    ollama: "Ollama",
    "openai-compatible": "OpenAI-Compatible",
};

/**
 * Display name for a provider flavor. Presentation only — nothing keys on
 * it. (When multi-instance providers arrive, a user-chosen instance label
 * would take precedence over this.)
 */
export function providerDisplayName(flavor: string): string {
    return PROVIDER_DISPLAY_NAMES[flavor] ?? flavor;
}

// Flavors whose lists come from the models.dev catalog cache (stable ids,
// no per-account variation); the live provider API is only a fallback when
// the cache is empty. Everything else always lists live.
const MODELS_DEV_FLAVORS = new Set(["openai", "anthropic", "google"]);

// listModelsForProvider builds aigateway's URL from baseURL; apply the
// service default here so a keyed-but-URL-less config still lists.
const AIGATEWAY_DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

// Successful lists are cached until the provider's credentials change or an
// explicit refresh; failures retry after a short TTL so a temporarily-down
// local server doesn't stay dark, without re-paying the fetch timeout on
// every catalog build in between.
const ERROR_RETRY_MS = 30_000;

interface CacheEntry {
    fingerprint: string;
    fetchedAt: number;
    status: "ok" | "error";
    error?: string;
    models: CatalogModelEntry[];
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

type ProviderConfig = z.infer<typeof LlmProvider>;

interface DiscoveredProvider {
    id: string;
    /** Absent for rowboat/codex — their auth lives outside models.json. */
    config?: ProviderConfig;
    savedModel?: string;
    /**
     * Saved models[] from config — the list of last resort for flavors the
     * live fetch doesn't support (an unknown flavor in the providers map).
     */
    savedModels?: string[];
}

async function readModelConfig(): Promise<z.infer<typeof LlmModelConfig> | null> {
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        return await repo.getConfig();
    } catch {
        // Signed-in users may have no models.json at all.
        return null;
    }
}

/**
 * Which providers are connected right now. Rowboat and ChatGPT come from
 * their auth state; everything else from the models.json providers map
 * (an entry counts as connected once it carries some credential). The
 * default provider's entry leads, matching picker ordering.
 */
async function discoverProviders(): Promise<DiscoveredProvider[]> {
    const discovered: DiscoveredProvider[] = [];

    if (await isSignedIn().catch(() => false)) {
        discovered.push({ id: "rowboat" });
    }
    try {
        const chatgpt = await getChatGPTStatus();
        if (chatgpt.signedIn) discovered.push({ id: "codex" });
    } catch {
        // ChatGPT status failures must never break the main list.
    }

    const cfg = await readModelConfig();
    const providersMap = cfg?.providers ?? {};
    const defaultFlavor = cfg?.provider.flavor ?? "";
    const flavors = Object.keys(providersMap)
        .sort((a, b) => (a === defaultFlavor ? -1 : b === defaultFlavor ? 1 : 0));

    for (const flavor of flavors) {
        const entry = providersMap[flavor] ?? {};
        const apiKey = entry.apiKey?.trim() ?? "";
        const baseURL = entry.baseURL?.trim() ?? "";
        if (!apiKey && !baseURL) continue; // provider not configured
        const savedModel = entry.model || undefined;
        const parsed = LlmProvider.safeParse({ ...entry, flavor });
        if (!parsed.success) {
            // Unknown flavor: not live-listable — serve the saved list.
            discovered.push({ id: flavor, savedModel, savedModels: entry.models ?? [] });
            continue;
        }
        const config = parsed.data;
        if (config.flavor === "aigateway" && !config.baseURL) {
            config.baseURL = AIGATEWAY_DEFAULT_BASE_URL;
        }
        discovered.push({ id: flavor, config, savedModel });
    }

    return discovered;
}

/** Cache key input: listing output depends only on flavor + credentials. */
function fingerprintOf(provider: DiscoveredProvider): string {
    if (!provider.config) return provider.id;
    const { flavor, apiKey, baseURL, headers } = provider.config;
    return JSON.stringify({ flavor, apiKey, baseURL, headers });
}

async function fetchProviderEntry(
    provider: DiscoveredProvider,
    fingerprint: string,
    modelsDevByFlavor: Map<string, CatalogModelEntry[]>,
): Promise<CacheEntry> {
    try {
        let models: CatalogModelEntry[];
        if (provider.id === "rowboat") {
            const result = await listGatewayModels();
            models = result.providers[0]?.models ?? [];
        } else if (provider.id === "codex") {
            const result = await listCodexModels();
            models = result.providers[0]?.models ?? [];
        } else if (MODELS_DEV_FLAVORS.has(provider.id) && (modelsDevByFlavor.get(provider.id)?.length ?? 0) > 0) {
            models = modelsDevByFlavor.get(provider.id) ?? [];
        } else if (!provider.config) {
            models = (provider.savedModels ?? []).map((id) => ({ id }));
        } else {
            // Live listing: local/custom flavors always, cloud flavors only
            // when the models.dev cache is empty (offline fresh install).
            const ids = await listModelsForProvider(provider.config);
            models = ids.map((id) => ({ id }));
        }
        return { fingerprint, fetchedAt: Date.now(), status: "ok", models };
    } catch (err) {
        return {
            fingerprint,
            fetchedAt: Date.now(),
            status: "error",
            error: err instanceof Error ? err.message : "Failed to list models",
            models: [],
        };
    }
}

async function resolveProviderEntry(
    provider: DiscoveredProvider,
    modelsDevByFlavor: Map<string, CatalogModelEntry[]>,
    forceRefresh: boolean,
): Promise<CacheEntry> {
    const fingerprint = fingerprintOf(provider);
    const cached = cache.get(provider.id);
    if (!forceRefresh && cached && cached.fingerprint === fingerprint) {
        const fresh = cached.status === "ok" || Date.now() - cached.fetchedAt < ERROR_RETRY_MS;
        if (fresh) return cached;
    }
    const pending = inFlight.get(provider.id);
    if (pending && !forceRefresh) return pending;

    const request = fetchProviderEntry(provider, fingerprint, modelsDevByFlavor)
        .then((entry) => {
            cache.set(provider.id, entry);
            return entry;
        })
        .finally(() => {
            if (inFlight.get(provider.id) === request) inFlight.delete(provider.id);
        });
    inFlight.set(provider.id, request);
    return request;
}

export interface GetModelCatalogOptions {
    /** Drop this provider's cached list and refetch it (Retry / Refresh models). */
    refreshProvider?: string;
}

export async function getModelCatalog(options?: GetModelCatalogOptions): Promise<ModelCatalogResult> {
    const discovered = await discoverProviders();

    // One models.dev read serves every cloud flavor in the build (disk cache,
    // no network — refreshed by its own background loop).
    const modelsDevByFlavor = new Map<string, CatalogModelEntry[]>();
    if (discovered.some((p) => MODELS_DEV_FLAVORS.has(p.id))) {
        try {
            const catalog = await listOnboardingModels();
            for (const p of catalog.providers) {
                modelsDevByFlavor.set(p.id, p.models.map(({ id, name, reasoning }) => ({
                    id,
                    ...(name ? { name } : {}),
                    ...(reasoning !== undefined ? { reasoning } : {}),
                })));
            }
        } catch {
            // Empty map → cloud flavors fall through to live listing.
        }
    }

    const entries = await Promise.all(discovered.map(async (provider) => {
        const entry = await resolveProviderEntry(
            provider,
            modelsDevByFlavor,
            options?.refreshProvider === provider.id,
        );
        const result: CatalogProviderEntry = {
            id: provider.id,
            // One instance per flavor today, so the id IS the flavor key.
            flavor: provider.config?.flavor ?? provider.id,
            status: entry.status,
            ...(entry.error ? { error: entry.error } : {}),
            ...(provider.savedModel ? { savedModel: provider.savedModel } : {}),
            models: entry.models,
        };
        return result;
    }));

    let defaultModel: ModelCatalogResult["defaultModel"] = null;
    try {
        defaultModel = await getDefaultModelAndProvider();
    } catch {
        // No default resolvable (no config, signed out) — the picker copes.
    }

    return { providers: entries, defaultModel };
}

/** Test-only: reset the per-provider list cache. */
export function __resetModelCatalogForTests(): void {
    cache.clear();
    inFlight.clear();
}
