import { ProviderV2 } from "@ai-sdk/provider";
import { createGateway } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getModelConfig } from "../config/config.js";

const providerMap: Record<string, ProviderV2> = {};

export async function getProvider(name: string = ""): Promise<ProviderV2> {
    // get model conf
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
        throw new Error("Model config not found");
    }
    if (!name) {
        name = modelConfig.defaults.provider;
    }
    if (providerMap[name]) {
        return providerMap[name];
    }
    const providerConfig = modelConfig.providers[name];
    if (!providerConfig) {
        throw new Error(`Provider ${name} not found`);
    }
    const { apiKey, baseURL, headers } = providerConfig;
    switch (providerConfig.flavor) {
        case "rowboat [free]":
            providerMap[name] = createGateway({
                apiKey: "rowboatx",
                baseURL: "https://ai-gateway.rowboatlabs.com/v1/ai",
            });
            break;
         case "openai":
            providerMap[name] = createOpenAI({
                apiKey,
                baseURL,
                headers,
            });
            break;
        case "aigateway":
            providerMap[name] = createGateway({
                apiKey,
                baseURL,
                headers
            });
            break;
        case "anthropic":
            providerMap[name] = createAnthropic({
                apiKey,
                baseURL,
                headers
            });
            break;
        case "google":
            providerMap[name] = createGoogleGenerativeAI({
                apiKey,
                baseURL,
                headers
            });
            break;
        case "ollama":
            providerMap[name] = createOllama({
                baseURL,
                headers
            });
            break;
        case "openai-compatible":
            providerMap[name] = createOpenAICompatible({
                name,
                apiKey,
                baseURL : baseURL || "",
                headers,
            });
            break;
        case "openrouter":
            providerMap[name] = createOpenRouter({
                apiKey,
                baseURL,
                headers
            });
            break;
        default:
            throw new Error(`Provider ${name} not found`);
    }
    return providerMap[name];
}