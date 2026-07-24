import { z } from "zod";
import { ModelRef, TaskModels } from "./models.js";
import { normalizeModelRecommendation, type ModelRecommendations } from "./rowboat-account.js";

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
 * Task-model recommendations ride along the same moment: when (and only
 * when) a connect seeds the assistant, the provider's per-task
 * recommendations become visible taskModels overrides — each validated
 * against the live list and skipped when it equals the chosen assistant
 * (inheritance already produces it; only differences are written).
 *
 * This runs ONLY when a provider is first connected and has no saved
 * selection. It must never run over an existing choice: after initial setup
 * the saved model configuration is the source of truth, and changes to the
 * recommendations or to the provider's list order must not silently replace
 * what the user picked.
 *
 * Pure functions by design: callers supply the provider's available models
 * (from the unified catalog / a live probe) and the recommendations map
 * (from /v1/config via rowboat:getConfig, keyed by provider FLAVOR in each
 * provider's native id format). Everything is best-effort — an absent map,
 * an unknown flavor, or a recommendation the provider doesn't serve all
 * degrade gracefully.
 */

const TASK_MODEL_KEYS = Object.keys(TaskModels.shape) as Array<keyof z.infer<typeof TaskModels>>;

export function selectInitialModel(
    flavor: string,
    availableModelIds: string[],
    recommendations: ModelRecommendations | undefined,
): string | null {
    const recommended = normalizeModelRecommendation(recommendations, flavor)?.assistantModel;
    if (recommended && availableModelIds.includes(recommended)) {
        return recommended;
    }
    return availableModelIds[0] ?? null;
}

export function selectInitialTaskModels(
    providerId: string,
    flavor: string,
    availableModelIds: string[],
    recommendations: ModelRecommendations | undefined,
    assistantModel: string,
): Partial<Record<keyof z.infer<typeof TaskModels>, z.infer<typeof ModelRef>>> {
    const taskRecommendations = normalizeModelRecommendation(recommendations, flavor)?.taskModels;
    if (!taskRecommendations) return {};
    const overrides: Partial<Record<keyof z.infer<typeof TaskModels>, z.infer<typeof ModelRef>>> = {};
    for (const key of TASK_MODEL_KEYS) {
        const model = taskRecommendations[key];
        // Unknown keys are ignored; a rec equal to the assistant is redundant
        // (inherit produces it); an unlisted rec is a stale hint.
        if (!model || model === assistantModel || !availableModelIds.includes(model)) continue;
        overrides[key] = { provider: providerId, model };
    }
    return overrides;
}
