import { ModelConfig } from "./models.js";
import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

export type ModelConfigPatch = {
    [K in
        | "defaultSelection"
        | "knowledgeGraphModel"
        | "meetingNotesModel"
        | "liveNoteAgentModel"
        | "autoPermissionDecisionModel"
        | "subagentModels"
        | "deferBackgroundTasks"]?: z.infer<typeof ModelConfig>[K] | null;
};

export interface IModelConfigRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof ModelConfig>>;
    setConfig(config: z.infer<typeof ModelConfig>): Promise<void>;
    // Merge the given top-level keys into the existing file without touching
    // provider credentials — hybrid settings (default selection, category
    // overrides) save through this. Omitted keys are untouched; an explicit
    // null clears the key back to its default.
    updateConfig(patch: ModelConfigPatch): Promise<void>;
}

const defaultConfig: z.infer<typeof ModelConfig> = {
    provider: {
        flavor: "openai",
    },
    model: "gpt-5.4",
};

export class FSModelConfigRepo implements IModelConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "models.json");

    async ensureConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
        }
    }

    async getConfig(): Promise<z.infer<typeof ModelConfig>> {
        const config = await fs.readFile(this.configPath, "utf8");
        return ModelConfig.parse(JSON.parse(config));
    }

    async setConfig(config: z.infer<typeof ModelConfig>): Promise<void> {
        let existingProviders: Record<string, Record<string, unknown>> = {};
        try {
            const raw = await fs.readFile(this.configPath, "utf8");
            const existing = JSON.parse(raw);
            existingProviders = existing.providers || {};
        } catch {
            // No existing config
        }

        existingProviders[config.provider.flavor] = {
            ...existingProviders[config.provider.flavor],
            apiKey: config.provider.apiKey,
            baseURL: config.provider.baseURL,
            headers: config.provider.headers,
            // Preserve hand-edited local-model tuning unless the caller sets it.
            ...(config.provider.contextLength !== undefined
                ? { contextLength: config.provider.contextLength }
                : {}),
            ...(config.provider.reasoningEffort !== undefined
                ? { reasoningEffort: config.provider.reasoningEffort }
                : {}),
            model: config.model,
            models: config.models,
            knowledgeGraphModel: config.knowledgeGraphModel,
            meetingNotesModel: config.meetingNotesModel,
            liveNoteAgentModel: config.liveNoteAgentModel,
            autoPermissionDecisionModel: config.autoPermissionDecisionModel,
        };

        // saveConfig owns provider credentials/model lists; the hybrid-mode
        // selections are owned by updateConfig — carry them over when the
        // incoming config doesn't set them.
        let existingSelections: Record<string, unknown> = {};
        try {
            const raw = await fs.readFile(this.configPath, "utf8");
            const existing = JSON.parse(raw);
            existingSelections = Object.fromEntries(
                ["defaultSelection", "knowledgeGraphModel", "meetingNotesModel", "liveNoteAgentModel", "autoPermissionDecisionModel", "subagentModels", "deferBackgroundTasks"]
                    .filter((key) => existing[key] !== undefined && (config as Record<string, unknown>)[key] === undefined)
                    .map((key) => [key, existing[key]]),
            );
        } catch {
            // No existing config
        }

        const toWrite = { ...existingSelections, ...config, providers: existingProviders };
        await fs.writeFile(this.configPath, JSON.stringify(toWrite, null, 2));
    }

    async updateConfig(patch: ModelConfigPatch): Promise<void> {
        const raw = await fs.readFile(this.configPath, "utf8");
        const existing = JSON.parse(raw) as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === null) {
                delete existing[key];
            } else {
                existing[key] = value;
            }
        }
        ModelConfig.parse(existing);
        await fs.writeFile(this.configPath, JSON.stringify(existing, null, 2));
    }
}
