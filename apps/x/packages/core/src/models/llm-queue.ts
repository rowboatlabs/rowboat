/**
 * Local-provider-aware LLM request prioritization.
 *
 * When the configured provider is local (Ollama, local openai-compatible),
 * background services (knowledge graph, email labeling, etc.) pause their
 * LLM calls while an interactive chat stream is in progress. This prevents
 * background inference from competing with the user's chat on a single GPU/CPU.
 *
 * Cloud providers bypass this entirely — they handle concurrency fine.
 */

import type { z } from "zod";
import type { LlmProvider } from "@x/shared/dist/models.js";

type ProviderFlavor = z.infer<typeof LlmProvider>["flavor"];

let chatActiveCount = 0;
let chatIdleResolvers: Array<() => void> = [];

export function markChatActive(): void {
    chatActiveCount++;
}

export function markChatIdle(): void {
    if (chatActiveCount <= 0) {
        console.warn("[llm-queue] markChatIdle called with no active chat — possible mismatched calls");
        return;
    }
    chatActiveCount--;
    if (chatActiveCount === 0) {
        const resolvers = chatIdleResolvers;
        chatIdleResolvers = [];
        for (const resolve of resolvers) {
            resolve();
        }
    }
}

export function isLocalProvider(flavor: ProviderFlavor): boolean {
    return flavor === "ollama" || flavor === "openai-compatible";
}

/**
 * Background services call this before each LLM request.
 * Returns immediately for cloud providers or when no chat is active.
 * For local providers with active chat, waits until chat finishes.
 */
export function waitIfChatActive(providerFlavor: ProviderFlavor, signal?: AbortSignal): Promise<void> {
    if (!isLocalProvider(providerFlavor)) {
        return Promise.resolve();
    }
    if (chatActiveCount === 0) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            const idx = chatIdleResolvers.indexOf(wrappedResolve);
            if (idx !== -1) chatIdleResolvers.splice(idx, 1);
            reject(signal!.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const wrappedResolve = () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        };
        chatIdleResolvers.push(wrappedResolve);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
