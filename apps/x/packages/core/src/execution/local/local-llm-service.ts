import { LanguageModel } from "ai";
import { z } from "zod";
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";
import { ILlmService } from "../llm-service.js";
import { createProvider, testModelConnection } from "../../models/models.js";

export class LocalLlmService implements ILlmService {
    getLanguageModel(config: z.infer<typeof LlmModelConfig>): LanguageModel {
        const provider = createProvider(config.provider);
        return provider.languageModel(config.model);
    }

    async testConnection(
        providerConfig: z.infer<typeof LlmProvider>,
        model: string,
        timeoutMs?: number,
    ): Promise<{ success: boolean; error?: string }> {
        return testModelConnection(providerConfig, model, timeoutMs);
    }
}
