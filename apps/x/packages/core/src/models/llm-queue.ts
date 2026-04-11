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

let chatActiveCount = 0;
let chatIdleResolvers: Array<() => void> = [];

/**
 * Call when an interactive chat LLM stream starts.
 * Nestable — supports concurrent interactive streams.
 */
export function markChatActive(): void {
    chatActiveCount++;
}

/**
 * Call when an interactive chat LLM stream ends.
 * When all interactive streams finish, waiting background tasks resume.
 */
export function markChatIdle(): void {
    chatActiveCount = Math.max(0, chatActiveCount - 1);
    if (chatActiveCount === 0) {
        const resolvers = chatIdleResolvers;
        chatIdleResolvers = [];
        for (const resolve of resolvers) {
            resolve();
        }
    }
}

/**
 * Returns true if the provider flavor represents a local inference server.
 */
export function isLocalProvider(flavor: string): boolean {
    return flavor === "ollama" || flavor === "openai-compatible";
}

/**
 * Background services call this before each LLM request.
 * - If the provider is cloud-based, returns immediately.
 * - If the provider is local and no chat is active, returns immediately.
 * - If the provider is local and chat IS active, waits until chat finishes.
 *
 * @param providerFlavor - The provider flavor string (e.g. "ollama", "openai", "anthropic")
 * @param signal - Optional AbortSignal to cancel the wait
 */
export function waitIfChatActive(providerFlavor: string, signal?: AbortSignal): Promise<void> {
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
