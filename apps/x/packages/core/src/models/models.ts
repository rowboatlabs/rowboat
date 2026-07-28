import { ProviderV4 } from "@ai-sdk/provider";
import { createGateway, generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";
import z from "zod";
import { getGatewayProvider } from "./gateway.js";
import { getCodexProvider } from "./codex.js";
import { getDefaultModelAndProvider, resolveProviderConfig } from "./defaults.js";
import { getChatModelIds } from "./models-dev.js";
import { withUseCase } from "../analytics/use_case.js";
import {
    applyLocalModelSettings,
    makeOllamaThinkFetch,
    DEFAULT_OLLAMA_CONTEXT_LENGTH,
    DEFAULT_OLLAMA_REASONING_EFFORT,
} from "./local.js";

export const Provider = LlmProvider;
export const ModelConfig = LlmModelConfig;

export function createProvider(config: z.infer<typeof Provider>): ProviderV4 {
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
                // Rewrites `think` on the wire: the provider itself can only
                // send think:false, which thinking models ignore — leaving
                // e.g. gpt-oss at medium effort. See makeOllamaThinkFetch.
                fetch: makeOllamaThinkFetch(
                    config.reasoningEffort ?? DEFAULT_OLLAMA_REASONING_EFFORT,
                ),
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
            }) as unknown as ProviderV4;
        case "rowboat":
            return getGatewayProvider();
        case "codex":
            return getCodexProvider();
        default:
            throw new Error(`Unsupported provider flavor: ${config.flavor}`);
    }
}

/**
 * The one place model instances are created. Applies local-runtime settings
 * (explicit Ollama context window) on top of the raw provider model.
 */
export function createLanguageModel(
    providerConfig: z.infer<typeof Provider>,
    modelId: string,
): LanguageModel {
    const model = createProvider(providerConfig).languageModel(modelId);
    return applyLocalModelSettings(model, providerConfig);
}

export interface ModelCapabilities {
    /** undefined = could not be determined (endpoint missing, non-local provider). */
    supportsTools?: boolean;
    maxContextLength?: number;
}

/**
 * Best-effort capability probe for local runtimes. Ollama reports a
 * `capabilities` list and the model's trained context window via /api/show;
 * LM Studio exposes the same through its /api/v0/models REST endpoint.
 * Failures are swallowed — an unknown capability is not an error.
 */
export async function probeModelCapabilities(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    timeoutMs = 5000,
): Promise<ModelCapabilities> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        if (providerConfig.flavor === "ollama") {
            const base = (providerConfig.baseURL ?? "http://localhost:11434")
                .replace(/\/+$/, "")
                .replace(/\/api$/, "");
            const res = await fetch(`${base}/api/show`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(providerConfig.headers ?? {}) },
                body: JSON.stringify({ model }),
                signal: controller.signal,
            });
            if (!res.ok) return {};
            const data = await res.json() as {
                capabilities?: string[];
                model_info?: Record<string, unknown>;
            };
            const result: ModelCapabilities = {};
            if (Array.isArray(data.capabilities)) {
                result.supportsTools = data.capabilities.includes("tools");
            }
            for (const [key, value] of Object.entries(data.model_info ?? {})) {
                if (key.endsWith(".context_length") && typeof value === "number") {
                    result.maxContextLength = value;
                    break;
                }
            }
            return result;
        }
        if (providerConfig.flavor === "openai-compatible") {
            // LM Studio's enhanced REST API lives at /api/v0 on the same
            // origin as the OpenAI-compatible /v1 endpoint. Non-LM Studio
            // endpoints just 404 here, which reports as "unknown".
            const origin = new URL(providerConfig.baseURL ?? "").origin;
            const res = await fetch(`${origin}/api/v0/models`, {
                headers: providerConfig.headers ?? {},
                signal: controller.signal,
            });
            if (!res.ok) return {};
            const data = await res.json() as { data?: Array<Record<string, unknown>> };
            const entry = (data.data ?? []).find((m) => m.id === model);
            if (!entry) return {};
            const result: ModelCapabilities = {};
            if (Array.isArray(entry.capabilities)) {
                result.supportsTools = (entry.capabilities as string[]).includes("tool_use");
            }
            const max = entry.loaded_context_length ?? entry.max_context_length;
            if (typeof max === "number") {
                result.maxContextLength = max;
            }
            return result;
        }
        return {};
    } catch {
        return {};
    } finally {
        clearTimeout(timeout);
    }
}

function capabilityWarnings(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    capabilities: ModelCapabilities,
): string[] {
    const warnings: string[] = [];
    if (capabilities.supportsTools === false) {
        warnings.push(
            `${model} does not support tool calling. Rowboat's assistant and background agents rely on tools; pick a tool-capable model (e.g. qwen3, gpt-oss, llama3.3).`,
        );
    }
    const configured = providerConfig.contextLength
        ?? (providerConfig.flavor === "ollama" ? DEFAULT_OLLAMA_CONTEXT_LENGTH : undefined);
    if (capabilities.maxContextLength !== undefined) {
        if (capabilities.maxContextLength < 16384) {
            warnings.push(
                `${model} has a ${capabilities.maxContextLength}-token context window. Rowboat's assistant needs ~16k+ tokens; expect truncated or confused responses.`,
            );
        } else if (configured !== undefined && capabilities.maxContextLength < configured) {
            warnings.push(
                `${model} supports at most ${capabilities.maxContextLength} context tokens, below the configured ${configured}. Set "contextLength" for this provider in models.json to ${capabilities.maxContextLength} or less.`,
            );
        }
    }
    return warnings;
}

export async function testModelConnection(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    timeoutMs?: number,
): Promise<{ success: boolean; error?: string; warnings?: string[]; capabilities?: ModelCapabilities }> {
    const isLocal = providerConfig.flavor === "ollama" || providerConfig.flavor === "openai-compatible";
    const effectiveTimeout = timeoutMs ?? (isLocal ? 60000 : 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
        const languageModel = createLanguageModel(providerConfig, model);
        await generateText({
            model: languageModel,
            prompt: "ping",
            abortSignal: controller.signal,
        });
        const capabilities = await probeModelCapabilities(providerConfig, model);
        const warnings = capabilityWarnings(providerConfig, model, capabilities);
        return {
            success: true,
            ...(warnings.length > 0 ? { warnings } : {}),
            capabilities,
        };
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
                // /api/v1/models is a public catalog — it returns the full
                // list even with an invalid/absent key, so listing it can't
                // tell a bad key from a good one (a false "Connected"). When
                // a key is given, hit the account-scoped /models/user behind
                // Bearer auth instead: a bad key 401s here and the shared
                // throw below surfaces it. Same OpenAI-shaped { data:[{id}] }
                // response, so the parse path is unchanged. No key → keep the
                // public catalog so an unconfigured provider can still preview.
                if (apiKey) {
                    url = "https://openrouter.ai/api/v1/models/user";
                    headers["Authorization"] = `Bearer ${apiKey}`;
                } else {
                    url = "https://openrouter.ai/api/v1/models";
                }
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
        const cleaned = ids.filter((id: string) => typeof id === "string" && id.length > 0);
        if (flavor === "openai" || flavor === "anthropic" || flavor === "google") {
            const chatIds = await getChatModelIds(flavor);
            // Only filter when models.dev returned data; if it's empty (offline/no
            // cache/unknown provider) keep the full list rather than showing none.
            if (chatIds.size > 0) {
                return cleaned.filter((id) => chatIds.has(id));
            }
        }
        return cleaned;
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
        const languageModel = createLanguageModel(providerConfig, modelId);
        const result = await withUseCase(
            { useCase: "copilot_chat", subUseCase: "email_compose" },
            () => generateText({
                model: languageModel,
                ...(opts.system ? { instructions: opts.system } : {}),
                prompt: opts.prompt,
            }),
        );
        return { text: result.text.trim(), model: modelId, provider: providerName };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
