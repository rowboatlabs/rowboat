import type { JsonValue } from "@x/shared/dist/turns.js";

// Anthropic prompt caching is opt-in: without explicit cache_control
// breakpoints every call re-bills the full prefix at the base input rate
// (observed sessions: 0% cache hits on Claude vs ~82% implicit hits on
// Gemini, whose caching is automatic). Two breakpoints of the 4 allowed:
//
//   1. the system prompt — Anthropic's cache prefix is tools -> system ->
//      messages, so this single breakpoint also covers the tool schemas;
//      both are immutable for the life of a turn (agent snapshot),
//   2. the last message — the incremental-conversation pattern: each call
//      writes a cache entry at the conversation tip, and the next call's
//      lookup reuses the longest previously written prefix.
//
// Writes bill 1.25x on the newly cached segment and reads bill 0.1x, so a
// segment pays for itself on its first re-read; only tokens written and
// never read again (a session's final tail) cost extra, capped at 25%.
//
// This is a transport-layer decoration ONLY: nothing is persisted, so the
// durable log stays provider-agnostic and recomposition is unaffected.
// Non-Anthropic requests pass through byte-identical. Failure degrades
// soft: the AI SDK Anthropic provider validates placement and ignores
// (with a warning) misplaced or excess breakpoints, and the OpenRouter
// provider reads the same providerOptions.anthropic key.
const CACHE_CONTROL: Record<string, JsonValue> = {
    cacheControl: { type: "ephemeral" },
};

// Anthropic models arrive three ways: the direct provider (flavor
// "anthropic", any model id), and aggregators (openrouter, aigateway, the
// rowboat gateway) that address them as "anthropic/<model>" or "claude-*".
export function isAnthropicModel(flavor: string, modelId: string): boolean {
    if (flavor === "anthropic") {
        return true;
    }
    const id = modelId.toLowerCase();
    return id.startsWith("anthropic/") || id.includes("claude");
}

export interface PromptShape {
    system?: string;
    messages: JsonValue[];
}

export function applyPromptCaching(
    flavor: string,
    modelId: string,
    prompt: { system: string; messages: JsonValue[] },
): PromptShape {
    if (!isAnthropicModel(flavor, modelId)) {
        return prompt;
    }
    // The system string moves into the message array so it can carry
    // per-message providerOptions (the AI SDK's documented breakpoint
    // mechanism); the provider reassembles it into the system field.
    const systemMessage: JsonValue = {
        role: "system",
        content: prompt.system,
        providerOptions: { anthropic: CACHE_CONTROL },
    };
    const messages = prompt.messages.map((message, index) => {
        if (index !== prompt.messages.length - 1) {
            return message;
        }
        const existing =
            typeof message === "object" && message !== null && !Array.isArray(message)
                ? message
                : {};
        const existingOptions =
            "providerOptions" in existing &&
            typeof existing.providerOptions === "object" &&
            existing.providerOptions !== null &&
            !Array.isArray(existing.providerOptions)
                ? existing.providerOptions
                : {};
        return {
            ...existing,
            providerOptions: {
                ...existingOptions,
                anthropic: {
                    ...(typeof existingOptions.anthropic === "object" &&
                    existingOptions.anthropic !== null &&
                    !Array.isArray(existingOptions.anthropic)
                        ? existingOptions.anthropic
                        : {}),
                    ...CACHE_CONTROL,
                },
            },
        };
    });
    return { messages: [systemMessage, ...messages] };
}
