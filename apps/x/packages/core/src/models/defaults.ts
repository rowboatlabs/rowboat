import z from "zod";
import { LlmProvider } from "@x/shared/dist/models.js";
import { IModelConfigRepo } from "./repo.js";
import { isSignedIn } from "../account/account.js";
import container from "../di/container.js";

const SIGNED_IN_DEFAULT_MODEL = "anthropic/claude-opus-4.7";
const SIGNED_IN_DEFAULT_PROVIDER = "rowboat";
// KG note-creation historically failed on identity (self-notes, perspective
// flips, misread outbound email) — root cause was the owner block never being
// injected, not the model tier. With identity injected + the NON-NEGOTIABLE
// RULES checklist + the end-of-message owner reminder, the lite tier is
// serviceable and 6x cheaper than full flash for this always-on service.
const SIGNED_IN_KG_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_LIVE_NOTE_AGENT_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL = "google/gemini-3.1-flash-lite";

/**
 * The single source of truth for "what model+provider should we use when
 * the caller didn't specify and the agent didn't declare". Returns names only.
 * This is the only place that branches on signed-in state.
 */
export async function getDefaultModelAndProvider(): Promise<{ model: string; provider: string }> {
    if (await isSignedIn()) {
        return { model: SIGNED_IN_DEFAULT_MODEL, provider: SIGNED_IN_DEFAULT_PROVIDER };
    }
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const cfg = await repo.getConfig();
    return { model: cfg.model, provider: cfg.provider.flavor };
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

/**
 * Model used by knowledge-graph agents (note_creation, labeling_agent, etc.)
 * when they're the top-level of a run. Signed-in: curated default.
 * BYOK: user override (`knowledgeGraphModel`) or assistant model.
 */
export async function getKgModel(): Promise<string> {
    if (await isSignedIn()) return SIGNED_IN_KG_MODEL;
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.knowledgeGraphModel ?? cfg.model;
}

/**
 * Model used by the live-note agent + routing classifier.
 * Signed-in: curated default. BYOK: user override (`liveNoteAgentModel`) or
 * assistant model.
 */
export async function getLiveNoteAgentModel(): Promise<string> {
    if (await isSignedIn()) return SIGNED_IN_LIVE_NOTE_AGENT_MODEL;
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.liveNoteAgentModel ?? cfg.model;
}

/**
 * Model used by the auto-permission classifier.
 * Signed-in: curated default. BYOK: user override
 * (`autoPermissionDecisionModel`) or assistant model.
 */
export async function getAutoPermissionDecisionModel(): Promise<string> {
    if (await isSignedIn()) return SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL;
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.autoPermissionDecisionModel ?? cfg.model;
}

/**
 * Model used by the meeting-notes summarizer. No special signed-in default —
 * historically meetings used the assistant model. BYOK: user override
 * (`meetingNotesModel`) or assistant model.
 */
export async function getMeetingNotesModel(): Promise<string> {
    if (await isSignedIn()) return SIGNED_IN_DEFAULT_MODEL;
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.meetingNotesModel ?? cfg.model;
}

/**
 * Model used by the background-task agent + routing classifier. Currently
 * mirrors `getLiveNoteAgentModel()` — both surfaces want a fast, reliable
 * agent model. Split into its own getter so a future per-feature override
 * doesn't require touching all call sites.
 */
export async function getBackgroundTaskAgentModel(): Promise<string> {
    return getLiveNoteAgentModel();
}
