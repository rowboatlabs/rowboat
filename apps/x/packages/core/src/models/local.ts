import { wrapLanguageModel, type LanguageModel } from "ai";
import type { z } from "zod";
import type { LlmProvider } from "@x/shared/dist/models.js";

// Ollama's server-side default context window (~4k tokens) is far below what
// Rowboat's agents need (the copilot's system prompt + tool schemas alone are
// ~15-20k tokens) and Ollama silently truncates the prompt from the top when
// it overflows — the model loses its own instructions. We therefore always
// request an explicit window for Ollama models. Overridable per provider via
// `contextLength` in models.json.
export const DEFAULT_OLLAMA_CONTEXT_LENGTH = 32768;

export type ReasoningEffort = "low" | "medium" | "high";

// Local models default to snappy: gpt-oss at medium effort spends ~3x the
// tokens of low on the same answer, and the AI SDK Ollama provider can't
// express effort at all (its `think` option is boolean-only and hardcoded to
// false, which thinking models like gpt-oss simply ignore).
export const DEFAULT_OLLAMA_REASONING_EFFORT: ReasoningEffort = "low";

/**
 * Wrap a language model so every call requests an explicit context window
 * from Ollama (merged under the caller's providerOptions — an explicit
 * caller value wins). Non-Ollama providers pass through untouched.
 */
export function applyLocalModelSettings(
    model: LanguageModel,
    providerConfig: z.infer<typeof LlmProvider>,
): LanguageModel {
    if (typeof model === "string" || providerConfig.flavor !== "ollama") {
        // Bare model-id strings resolve through the global registry; local
        // providers never take this path.
        return model;
    }
    const numCtx = providerConfig.contextLength ?? DEFAULT_OLLAMA_CONTEXT_LENGTH;
    return wrapLanguageModel({
        model,
        middleware: {
            transformParams: async ({ params }) => {
                const providerOptions = (params.providerOptions ?? {}) as Record<string, Record<string, unknown>>;
                const ollama = (providerOptions.ollama ?? {}) as Record<string, unknown>;
                const options = (ollama.options ?? {}) as Record<string, unknown>;
                return {
                    ...params,
                    providerOptions: {
                        ...providerOptions,
                        ollama: {
                            ...ollama,
                            options: { num_ctx: numCtx, ...options },
                        },
                    },
                };
            },
        },
    });
}

/**
 * Map a configured effort to the Ollama `think` value for a given model.
 * - gpt-oss accepts effort levels directly ("low" | "medium" | "high").
 * - Other thinking models (qwen3, deepseek-r1, …) only toggle: low turns
 *   thinking off, high forces it on, medium leaves the model default.
 * - Models without the thinking capability must not receive `think` at all.
 * Returns undefined when `think` should be stripped from the request.
 */
export function resolveThinkValue(
    modelName: string,
    effort: ReasoningEffort,
    supportsThinking: boolean,
): boolean | string | undefined {
    if (/gpt-oss/i.test(modelName)) {
        return effort;
    }
    if (!supportsThinking) {
        return undefined;
    }
    switch (effort) {
        case "low":
            return false;
        case "medium":
            return undefined;
        case "high":
            return true;
    }
}

// The ollama-ai-provider-v2 request builder always writes `think: false`
// (its providerOptions schema is boolean-only), so effort can only be set by
// rewriting the wire request. This wraps fetch for createOllama: /api/chat
// bodies get `think` set per resolveThinkValue; every other request passes
// through untouched. Thinking capability is probed once per model via
// /api/show and cached for the process lifetime.
export function makeOllamaThinkFetch(
    effort: ReasoningEffort,
): typeof fetch {
    const thinkingSupport = new Map<string, Promise<boolean>>();

    const supportsThinking = (chatUrl: string, model: string): Promise<boolean> => {
        const showUrl = chatUrl.replace(/\/chat(\?.*)?$/, "/show");
        const key = `${showUrl}|${model}`;
        let cached = thinkingSupport.get(key);
        if (!cached) {
            cached = fetch(showUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model }),
            })
                .then(async (res) => {
                    if (!res.ok) return false;
                    const data = await res.json() as { capabilities?: string[] };
                    return Array.isArray(data.capabilities) && data.capabilities.includes("thinking");
                })
                .catch(() => false);
            thinkingSupport.set(key, cached);
        }
        return cached;
    };

    return async (input, init) => {
        try {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const isChat = /\/api\/chat(\?.*)?$/.test(url);
            const body = init?.body;
            if (isChat && typeof body === "string") {
                const parsed = JSON.parse(body) as Record<string, unknown>;
                const model = typeof parsed.model === "string" ? parsed.model : "";
                const think = resolveThinkValue(model, effort, await supportsThinking(url, model));
                if (think === undefined) {
                    delete parsed.think;
                } else {
                    parsed.think = think;
                }
                return fetch(input, { ...init, body: JSON.stringify(parsed) });
            }
        } catch {
            // Malformed body or URL — send the original request unchanged.
        }
        return fetch(input, init);
    };
}
