import { capture, setPersonProperties } from "./posthog.js";
import type { IModelConfigRepo } from "../models/repo.js";

/**
 * Provider-level analytics for model selection.
 *
 * Privacy rules, encoded here so call sites can't get them wrong:
 * - Only provider FLAVORS ever leave the app. Instance ids equal flavor keys
 *   today, but a future multi-key setup makes ids user-named — so every
 *   surface maps id → flavor before capturing.
 * - Never credentials: no apiKey, no headers, and no baseURL (local
 *   endpoints can carry internal hostnames).
 * - Model ids are fine (they already ride on llm_usage).
 *
 * All I/O is lazy (dynamic imports, container resolution at call time) so
 * this module stays import-cycle-free — models/repo.ts imports it.
 */

const FLAVOR_CACHE_TTL_MS = 10_000;
let flavorCache: { at: number; byId: Map<string, string> } | null = null;

async function resolveRepo(): Promise<IModelConfigRepo> {
    const { default: container } = await import("../di/container.js");
    return container.resolve<IModelConfigRepo>("modelConfigRepo");
}

async function providerFlavorsById(): Promise<Map<string, string>> {
    if (flavorCache && Date.now() - flavorCache.at < FLAVOR_CACHE_TTL_MS) {
        return flavorCache.byId;
    }
    const byId = new Map<string, string>();
    try {
        const cfg = await (await resolveRepo()).getConfig();
        for (const [id, entry] of Object.entries(cfg.providers)) {
            byId.set(id, entry.flavor);
        }
    } catch {
        // No config yet — empty map; ids fall through unchanged.
    }
    flavorCache = { at: Date.now(), byId };
    return byId;
}

/**
 * Map a provider instance id to its flavor for analytics. Unknown ids fall
 * back to the raw value — which today always equals the flavor key.
 */
export async function flavorForProviderId(id: string): Promise<string> {
    if (id === "rowboat" || id === "codex") return id;
    return (await providerFlavorsById()).get(id) ?? id;
}

export function invalidateFlavorCache(): void {
    flavorCache = null;
}

/**
 * Refresh the person properties describing the user's provider setup:
 * `llm_provider_flavors` (sorted, includes rowboat/codex from auth state),
 * `llm_provider_count`, and the configured assistant model. Call after any
 * provider or assistant change; also called on every app launch so existing
 * installs get baselined without waiting for an action.
 */
export async function syncModelProviderPersonProperties(): Promise<void> {
    try {
        const cfg = await (await resolveRepo()).getConfig().catch(() => null);
        const { isSignedIn } = await import("../account/account.js");
        const { getChatGPTStatus } = await import("../auth/chatgpt-auth.js");
        const flavors = new Set<string>();
        for (const entry of Object.values(cfg?.providers ?? {})) {
            flavors.add(entry.flavor);
        }
        if (await isSignedIn().catch(() => false)) flavors.add("rowboat");
        const chatgpt = await getChatGPTStatus().catch(() => ({ signedIn: false }));
        if (chatgpt.signedIn) flavors.add("codex");

        const assistant = cfg?.assistantModel ?? null;
        setPersonProperties({
            llm_provider_flavors: [...flavors].sort(),
            llm_provider_count: flavors.size,
            ...(assistant
                ? {
                    assistant_model: assistant.model,
                    assistant_model_flavor: await flavorForProviderId(assistant.provider),
                }
                : {}),
        });
    } catch (err) {
        console.error("[Analytics] provider person-props sync failed:", err);
    }
}

/** One provider became connected (any surface: settings, onboarding, sign-in). */
export function captureProviderConnected(flavor: string): void {
    capture("llm_provider_connected", { flavor });
    invalidateFlavorCache();
    void syncModelProviderPersonProperties();
}

/** One provider was disconnected / signed out. */
export function captureProviderDisconnected(flavor: string): void {
    capture("llm_provider_disconnected", { flavor });
    invalidateFlavorCache();
    void syncModelProviderPersonProperties();
}
