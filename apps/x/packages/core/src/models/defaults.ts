import z from "zod";
import { LlmProvider } from "@x/shared/dist/models.js";
import { IModelConfigRepo } from "./repo.js";
import container from "../di/container.js";

/**
 * The single source of truth for "what model+provider should we use when
 * the caller didn't specify and the agent didn't declare". Always reads from
 * the user's models.json config (BYOK mode).
 */
export async function getDefaultModelAndProvider(): Promise<{ model: string; provider: string }> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const cfg = await repo.getConfig();
    return { model: cfg.model, provider: cfg.provider.flavor };
}

/**
 * Resolve a provider name (as stored on a run, an agent, or returned by
 * getDefaultModelAndProvider) into the full LlmProvider config that
 * createProvider expects (apiKey/baseURL/headers).
 *
 * - other names → look up models.json's `providers[name]` map.
 * - fallback: if the name matches the active default's flavor (legacy
 *   single-provider configs that didn't write to the providers map yet).
 */
export async function resolveProviderConfig(name: string): Promise<z.infer<typeof LlmProvider>> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const cfg = await repo.getConfig();
    const entry = cfg.providers?.[name];
    if (entry) {
        return LlmProvider.parse({
            flavor: name,
            apiKey: entry.apiKey,
            baseURL: entry.baseURL,
            headers: entry.headers,
        });
    }
    if (cfg.provider.flavor === name) {
        return cfg.provider;
    }
    throw new Error(`Provider '${name}' is referenced but not configured`);
}

/**
 * Model used by knowledge-graph agents (note_creation, labeling_agent, etc.)
 * BYOK: user override (`knowledgeGraphModel`) or assistant model.
 */
export async function getKgModel(): Promise<string> {
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.knowledgeGraphModel ?? cfg.model;
}

/**
 * Model used by track-block runner + routing classifier.
 * BYOK: user override (`trackBlockModel`) or assistant model.
 */
export async function getTrackBlockModel(): Promise<string> {
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.trackBlockModel ?? cfg.model;
}

/**
 * Model used by the meeting-notes summarizer.
 * BYOK: user override (`meetingNotesModel`) or assistant model.
 */
export async function getMeetingNotesModel(): Promise<string> {
    const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
    return cfg.meetingNotesModel ?? cfg.model;
}
