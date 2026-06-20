import { ProviderV2 } from "@ai-sdk/provider";
import { createGateway, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";
import z from "zod";
import { getGatewayProvider } from "./gateway.js";
import { getDefaultModelAndProvider, resolveProviderConfig } from "./defaults.js";
import { withUseCase } from "../analytics/use_case.js";

export const Provider = LlmProvider;
export const ModelConfig = LlmModelConfig;

export function createProvider(config: z.infer<typeof Provider>): ProviderV2 {
    const { apiKey, baseURL, headers } = config;
    switch (config.flavor) {
        case "openai":
            return createOpenAI({
                apiKey,
                baseURL,
                headers,
            });
        case "aigateway":
            return createGateway({
                apiKey,
                baseURL,
                headers,
            });
        case "anthropic":
            return createAnthropic({
                apiKey,
                baseURL,
                headers,
            });
        case "google":
            return createGoogleGenerativeAI({
                apiKey,
                baseURL,
                headers,
            });
        case "ollama": {
            // ollama-ai-provider-v2 expects baseURL to include /api
            let ollamaURL = baseURL;
            if (ollamaURL && !ollamaURL.replace(/\/+$/, '').endsWith('/api')) {
                ollamaURL = ollamaURL.replace(/\/+$/, '') + '/api';
            }
            return createOllama({
                baseURL: ollamaURL,
                headers,
            });
        }
        case "openai-compatible":
            return createOpenAICompatible({
                name: "openai-compatible",
                apiKey,
                baseURL: baseURL || "",
                headers,
            });
        case "openrouter":
            return createOpenRouter({
                apiKey,
                baseURL,
                headers,
            }) as unknown as ProviderV2;
        case "rowboat":
            return getGatewayProvider();
        default:
            throw new Error(`Unsupported provider flavor: ${config.flavor}`);
    }
}

export async function testModelConnection(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    timeoutMs?: number,
): Promise<{ success: boolean; error?: string }> {
    const isLocal = providerConfig.flavor === "ollama" || providerConfig.flavor === "openai-compatible";
    const effectiveTimeout = timeoutMs ?? (isLocal ? 60000 : 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
        const provider = createProvider(providerConfig);
        const languageModel = provider.languageModel(model);
        await generateText({
            model: languageModel,
            prompt: "ping",
            abortSignal: controller.signal,
        });
        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Connection test failed";
        return { success: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}

export interface GenerateTextOptions {
    prompt: string;
    system?: string;
    /** Model id. Falls back to the active default when omitted. */
    model?: string;
    /** Provider name (e.g. "rowboat", "openai"). Falls back to the active default. */
    provider?: string;
}

export interface GenerateTextResult {
    text?: string;
    /** The model/provider actually used (after resolving defaults). */
    model?: string;
    provider?: string;
    error?: string;
}

/**
 * One-shot text generation for lightweight UI features (e.g. the email
 * composer's "write with AI"). Resolves the requested model+provider, falling
 * back to the active default, and returns the generated text. Never throws —
 * errors are returned in the result so the renderer can surface them.
 */
export async function generateOneShot(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    try {
        const def = await getDefaultModelAndProvider();
        const modelId = opts.model || def.model;
        const providerName = opts.provider || def.provider;
        const providerConfig = await resolveProviderConfig(providerName);
        const languageModel = createProvider(providerConfig).languageModel(modelId);
        const result = await withUseCase(
            { useCase: "copilot_chat", subUseCase: "email_compose" },
            () => generateText({
                model: languageModel,
                ...(opts.system ? { system: opts.system } : {}),
                prompt: opts.prompt,
            }),
        );
        return { text: result.text.trim(), model: modelId, provider: providerName };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
