import { createOpenAI, OpenAIProvider } from "@ai-sdk/openai";
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { DefaultModel, DefaultProvider, Providers } from "../config/config.js";

const providerMap: Record<string, OpenAIProvider | GoogleGenerativeAIProvider | AnthropicProvider> = {};

export function getProvider(name: string = "") {
    if (!name) {
        name = DefaultProvider;
    }
    if (providerMap[name]) {
        return providerMap[name];
    }
    const providerConfig = Providers[name];
    if (!providerConfig) {
        throw new Error(`Provider ${name} not found`);
    }
    switch (providerConfig.flavor) {
        case "openai":
            providerMap[name] = createOpenAI({
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseURL,
            });
            break;
        case "anthropic":
            providerMap[name] = createAnthropic({
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseURL,
            });
            break;
        case "google":
            providerMap[name] = createGoogleGenerativeAI({
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseURL,
            });
            break;
    }
    return providerMap[name];
}