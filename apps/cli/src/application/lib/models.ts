import { createOpenAI, OpenAIProvider } from "@ai-sdk/openai";
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { OllamaProvider, createOllama } from "ollama-ai-provider-v2";
import { ModelConfig } from "../config/config.js";

const providerMap: Record<string, OpenAIProvider | GoogleGenerativeAIProvider | AnthropicProvider | OllamaProvider> = {};

export function getProvider(name: string = "") {
    if (!name) {
        name = ModelConfig.defaults.provider;
    }
    if (providerMap[name]) {
        return providerMap[name];
    }
    const providerConfig = ModelConfig.providers[name];
    if (!providerConfig) {
        throw new Error(`Provider ${name} not found`);
    }
    switch (providerConfig.flavor) {
        case "openai":
            providerMap[name] = createOpenAI({
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseURL,
                headers: providerConfig.headers,
            });
            break;
        case "anthropic":
            providerMap[name] = createAnthropic({
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseURL,
                headers: providerConfig.headers,
            });
            break;
        case "google":
            providerMap[name] = createGoogleGenerativeAI({
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseURL,
                headers: providerConfig.headers,
            });
            break;
        case "ollama":
            providerMap[name] = createOllama({
                baseURL: providerConfig.baseURL,
                headers: providerConfig.headers,
            });
            break;
    }
    return providerMap[name];
}