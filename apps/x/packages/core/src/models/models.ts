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

export async function listModelsForProvider(
    providerConfig: z.infer<typeof Provider>,
    timeoutMs = 8000,
): Promise<string[]> {
    const { flavor, apiKey, baseURL } = providerConfig;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let url = "";
        const headers: Record<string, string> = {};

        switch (flavor) {
            case "openai":
                url = "https://api.openai.com/v1/models";
                headers["Authorization"] = `Bearer ${apiKey}`;
                break;
            case "anthropic":
                url = "https://api.anthropic.com/v1/models";
                headers["x-api-key"] = apiKey ?? "";
                headers["anthropic-version"] = "2023-06-01";
                break;
            case "google":
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey ?? ""}`;
                break;
            case "openrouter":
                url = "https://openrouter.ai/api/v1/models";
                if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
                break;
            case "ollama":
                url = `${(baseURL ?? "http://localhost:11434").replace(/\/$/, "")}/api/tags`;
                break;
            case "openai-compatible":
            case "aigateway":
                url = `${(baseURL ?? "").replace(/\/$/, "")}/models`;
                if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
                break;
            default:
                throw new Error(`Unsupported provider flavor: ${flavor}`);
        }

        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Failed to list models (${res.status}): ${body.slice(0, 200)}`);
        }
        const data = await res.json();

        // Normalize each provider's response shape into a flat list of model id strings.
        let ids: string[] = [];
        if (flavor === "google") {
            // { models: [{ name: "models/gemini-..." }] }
            ids = (data.models ?? []).map((m: { name: string }) => m.name.replace(/^models\//, ""));
        } else if (flavor === "ollama") {
            // { models: [{ name: "llama3:latest" }] }
            ids = (data.models ?? []).map((m: { name: string }) => m.name);
        } else {
            // OpenAI-shaped: { data: [{ id: "..." }] }
            ids = (data.data ?? []).map((m: { id: string }) => m.id);
        }
        return ids.filter((id: string) => typeof id === "string" && id.length > 0);
    } finally {
        clearTimeout(timeout);
    }
}
