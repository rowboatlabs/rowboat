/**
 * Initial model selection for a provider being connected for the first time.
 *
 * Implements the selection order from the provider/model-selection spec:
 *   1. If Rowboat's recommended model for this flavor appears in the
 *      provider's available list, pick it.
 *   2. Otherwise pick the first model the provider returned.
 *   3. With no list at all, return null — the caller offers retry or manual
 *      entry.
 *
 * This runs ONLY when a provider is first connected and has no saved
 * selection. It must never run over an existing choice: after initial setup
 * the saved model configuration is the source of truth, and changes to the
 * recommendations or to the provider's list order must not silently replace
 * what the user picked.
 *
 * Pure function by design: the caller supplies the provider's available
 * models (from the unified catalog / a live probe) and the recommendations
 * map (from /v1/config via rowboat:getConfig, keyed by provider FLAVOR in
 * each provider's native id format). Recommendations are best-effort — an
 * absent map, an unknown flavor, or a recommendation the provider doesn't
 * serve all degrade to "first available model".
 */
export function selectInitialModel(
    flavor: string,
    availableModelIds: string[],
    recommendations: Record<string, string> | undefined,
): string | null {
    const recommended = recommendations?.[flavor];
    if (recommended && availableModelIds.includes(recommended)) {
        return recommended;
    }
    return availableModelIds[0] ?? null;
}
