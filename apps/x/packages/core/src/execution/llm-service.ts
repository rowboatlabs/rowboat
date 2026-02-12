import { LanguageModel } from "ai";
import { z } from "zod";
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";

export interface ILlmService {
    getLanguageModel(config: z.infer<typeof LlmModelConfig>): LanguageModel;
    testConnection(
        provider: z.infer<typeof LlmProvider>,
        model: string,
        timeoutMs?: number,
    ): Promise<{ success: boolean; error?: string }>;
}
