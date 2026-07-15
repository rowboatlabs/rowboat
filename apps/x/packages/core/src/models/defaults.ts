import z from "zod";
import { LlmModelConfig, LlmProvider, ModelRef } from "@x/shared/dist/models.js";
import { IModelConfigRepo } from "./repo.js";
import { isSignedIn } from "../account/account.js";
import container from "../di/container.js";

const SIGNED_IN_DEFAULT_MODEL = "google/gemini-3.5-flash";
const SIGNED_IN_DEFAULT_PROVIDER = "rowboat";
// KG note-creation historically failed on identity (self-notes, perspective
// flips, misread outbound email) — root cause was the owner block never being
// injected, not the model tier. With identity injected + the NON-NEGOTIABLE
// RULES checklist + the end-of-message owner reminder, the lite tier is
// serviceable and 6x cheaper than full flash for this always-on service.
const SIGNED_IN_KG_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_LIVE_NOTE_AGENT_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL = "google/gemini-3.1-flash-lite";
// Sub-agent tiers: the light model must stay one we've verified at
// multi-step tool calling — spawned children are agentic, not one-shot.
const SIGNED_IN_SUBAGENT_LIGHT_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_SUBAGENT_MEDIUM_MODEL = "anthropic/claude-sonnet-4.6";
const SIGNED_IN_SUBAGENT_HEAVY_MODEL = "anthropic/claude-opus-4.8";

export type ModelSelection = z.infer<typeof ModelRef>;

async function readConfig(): Promise<z.infer<typeof LlmModelConfig> | null> {
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        return await repo.getConfig();
    } catch {
        // Signed-in users may have no models.json at all.
        return null;
    }
}

/**
 * The single source of truth for "what model+provider should we use when
 * the caller didn't specify and the agent didn't declare".
 *
 * Resolution order (hybrid mode):
 * 1. `defaultSelection` — the user's explicit choice; may point at the
 *    gateway ("rowboat") or any BYOK provider, and is honored in both modes
 *    (a "rowboat" selection is skipped while signed out — it needs auth).
 * 2. Signed in → the curated gateway default.
 * 3. BYOK → the legacy top-level provider/model pair.
 */
export async function getDefaultModelAndProvider(): Promise<{ model: string; provider: string }> {
    const signedIn = await isSignedIn();
    const cfg = await readConfig();
    const selection = cfg?.defaultSelection;
    if (selection && (selection.provider !== "rowboat" || signedIn)) {
        return { model: selection.model, provider: selection.provider };
    }
    if (signedIn) {
        return { model: SIGNED_IN_DEFAULT_MODEL, provider: SIGNED_IN_DEFAULT_PROVIDER };
    }
    if (!cfg) {
        throw new Error("No model configuration found (models.json missing and not signed in)");
    }
    return { model: cfg.model, provider: cfg.provider.flavor };
}

/**
 * "Defer background tasks while a chat is running" (settings checkbox,
 * models.json `deferBackgroundTasks`). Read at each background invocation so
 * toggling takes effect immediately.
 */
export async function shouldDeferBackgroundTasks(): Promise<boolean> {
    const cfg = await readConfig();
    return cfg?.deferBackgroundTasks === true;
}

/**
 * Resolve a provider name (as stored on a run, an agent, or returned by
 * getDefaultModelAndProvider) into the full LlmProvider config that
 * createProvider expects (apiKey/baseURL/headers).
 *
 * - "rowboat" → gateway provider (auth via OAuth bearer; no creds field).
 * - other names → look up models.json's `providers[name]` map.
 * - fallback: if the name matches the active default's flavor (legacy
 *   single-provider configs that didn't write to the providers map yet).
 */
export async function resolveProviderConfig(name: string): Promise<z.infer<typeof LlmProvider>> {
    if (name === "rowboat") {
        return { flavor: "rowboat" };
    }
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const cfg = await repo.getConfig();
    const entry = cfg.providers?.[name];
    if (entry) {
        return LlmProvider.parse({
            flavor: name,
            apiKey: entry.apiKey,
            baseURL: entry.baseURL,
            headers: entry.headers,
            contextLength: entry.contextLength,
            reasoningEffort: entry.reasoningEffort,
        });
    }
    if (cfg.provider.flavor === name) {
        return cfg.provider;
    }
    throw new Error(`Provider '${name}' is referenced but not configured`);
}

// Per-category model resolution (hybrid mode):
// 1. An explicit override wins in BOTH modes. Provider-qualified refs are
//    used as-is (a "rowboat" ref is skipped while signed out); legacy string
//    overrides pair with the BYOK provider they were configured against
//    (the top-level flavor), NOT the dynamic default — so a signed-in user's
//    local-model overrides keep routing to their local server.
// 2. No override, signed in → the curated gateway model.
// 3. No override, BYOK → the assistant default.
async function getCategoryModel(
    category: "knowledgeGraphModel" | "meetingNotesModel" | "liveNoteAgentModel" | "autoPermissionDecisionModel",
    curatedModel: string,
): Promise<ModelSelection> {
    const signedIn = await isSignedIn();
    const cfg = await readConfig();
    const override = cfg?.[category];
    if (override) {
        if (typeof override === "string") {
            if (cfg) {
                return { model: override, provider: cfg.provider.flavor };
            }
        } else if (override.provider !== "rowboat" || signedIn) {
            return { model: override.model, provider: override.provider };
        }
    }
    if (signedIn) {
        return { model: curatedModel, provider: SIGNED_IN_DEFAULT_PROVIDER };
    }
    return getDefaultModelAndProvider();
}

/**
 * Model used by knowledge-graph agents (note_creation, labeling_agent, etc.)
 * when they're the top-level of a run.
 */
export async function getKgModel(): Promise<ModelSelection> {
    return getCategoryModel("knowledgeGraphModel", SIGNED_IN_KG_MODEL);
}

/** Model used by the live-note agent + routing classifier. */
export async function getLiveNoteAgentModel(): Promise<ModelSelection> {
    return getCategoryModel("liveNoteAgentModel", SIGNED_IN_LIVE_NOTE_AGENT_MODEL);
}

/** Model used by the auto-permission classifier. */
export async function getAutoPermissionDecisionModel(): Promise<ModelSelection> {
    return getCategoryModel("autoPermissionDecisionModel", SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL);
}

/**
 * Model used by the meeting-notes summarizer. No special signed-in curated
 * model — historically meetings used the assistant model.
 */
export async function getMeetingNotesModel(): Promise<ModelSelection> {
    return getCategoryModel("meetingNotesModel", SIGNED_IN_DEFAULT_MODEL);
}

/**
 * Model used by the background-task agent + routing classifier. Currently
 * mirrors `getLiveNoteAgentModel()` — both surfaces want a fast, reliable
 * agent model. Split into its own getter so a future per-feature override
 * doesn't require touching all call sites.
 */
export async function getBackgroundTaskAgentModel(): Promise<ModelSelection> {
    return getLiveNoteAgentModel();
}

export type SubagentTier = "light" | "medium" | "heavy";

// Suggested tier defaults, written into models.json once at Rowboat
// sign-in (seedSubagentModelDefaults). Purely seed values — runtime
// resolution reads the config, so users can retune tiers in settings
// without an app update.
const SUBAGENT_TIER_SEED: Record<SubagentTier, ModelSelection> = {
    light: {
        provider: SIGNED_IN_DEFAULT_PROVIDER,
        model: SIGNED_IN_SUBAGENT_LIGHT_MODEL,
    },
    medium: {
        provider: SIGNED_IN_DEFAULT_PROVIDER,
        model: SIGNED_IN_SUBAGENT_MEDIUM_MODEL,
    },
    heavy: {
        provider: SIGNED_IN_DEFAULT_PROVIDER,
        model: SIGNED_IN_SUBAGENT_HEAVY_MODEL,
    },
};

/**
 * Model for a spawned sub-agent's capability tier. The tier is a semantic
 * hint from the parent LLM (it knows task difficulty, not the user's model
 * inventory); the user's `subagentModels` config owns the mapping.
 *
 * Returns null whenever the tier cannot or should not be mapped — the
 * caller then inherits the parent model, which is always safe:
 * - tier absent, or not configured in `subagentModels` (unset tiers mean
 *   "just use the current model" in both modes);
 * - the configured ref points at the gateway while signed out (same rule
 *   as every other "rowboat" model ref).
 */
export async function getSubagentModel(
    tier: SubagentTier | undefined,
): Promise<ModelSelection | null> {
    if (tier !== "light" && tier !== "medium" && tier !== "heavy") {
        return null;
    }
    const cfg = await readConfig();
    const ref = cfg?.subagentModels?.[tier];
    if (!ref) {
        return null;
    }
    if (ref.provider === SIGNED_IN_DEFAULT_PROVIDER && !(await isSignedIn())) {
        return null;
    }
    return { provider: ref.provider, model: ref.model };
}

/**
 * One-time write of suggested tier defaults, called when a Rowboat sign-in
 * completes. Deliberately idempotent-by-absence: if `subagentModels` exists
 * at all (user-configured, or a previous seed), nothing is written — a
 * re-sign-in never clobbers user edits.
 */
export async function seedSubagentModelDefaults(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    await repo.ensureConfig();
    const cfg = await readConfig();
    if (cfg?.subagentModels) {
        return;
    }
    await repo.updateConfig({ subagentModels: SUBAGENT_TIER_SEED });
}
