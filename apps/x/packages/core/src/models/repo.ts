import { ModelConfig } from "./models.js";
import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { ConfiguredModelsResult, LlmProvider } from "@x/shared/dist/models.js";

type LlmProviderFlavor = z.infer<typeof LlmProvider>["flavor"];

export interface IModelConfigRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof ModelConfig>>;
    setConfig(config: z.infer<typeof ModelConfig>): Promise<void>;
    getAllConfiguredModels(): Promise<z.infer<typeof ConfiguredModelsResult>>;
}

const defaultConfig: z.infer<typeof ModelConfig> = {
    provider: {
        flavor: "openai",
    },
    model: "gpt-4.1",
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
            model: config.model,
            models: config.models,
            knowledgeGraphModel: config.knowledgeGraphModel,
        };

        const toWrite = { ...config, providers: existingProviders };
        await fs.writeFile(this.configPath, JSON.stringify(toWrite, null, 2));
    }

    async getAllConfiguredModels(): Promise<z.infer<typeof ConfiguredModelsResult>> {
        const raw = await fs.readFile(this.configPath, "utf8");
        const parsed = JSON.parse(raw);
        const models: z.infer<typeof ConfiguredModelsResult>["models"] = [];

        if (parsed?.providers) {
            for (const [flavor, entry] of Object.entries(parsed.providers) as [LlmProviderFlavor, unknown][]) {
                const e = entry as Record<string, unknown>;
                const modelList: string[] = Array.isArray(e.models) ? e.models as string[] : [];
                const singleModel = typeof e.model === "string" ? e.model : "";
                const allModels = modelList.length > 0 ? modelList : singleModel ? [singleModel] : [];
                for (const model of allModels) {
                    if (model) {
                        models.push({
                            flavor,
                            model,
                            apiKey: (e.apiKey as string) || undefined,
                            baseURL: (e.baseURL as string) || undefined,
                            headers: (e.headers as Record<string, string>) || undefined,
                            knowledgeGraphModel: (e.knowledgeGraphModel as string) || undefined,
                        });
                    }
                }
            }
        }

        const activeModelKey = parsed?.provider?.flavor && parsed?.model
            ? `${parsed.provider.flavor}/${parsed.model}`
            : "";

        models.sort((a, b) => {
            const aKey = `${a.flavor}/${a.model}`;
            const bKey = `${b.flavor}/${b.model}`;
            if (aKey === activeModelKey) return -1;
            if (bKey === activeModelKey) return 1;
            return 0;
        });

        return { models, activeModelKey };
    }
}
