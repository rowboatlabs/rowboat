import container from "../di/container.js";
import { IModelConfigRepo } from "./repo.js";
import { listCodexModels } from "./codex.js";
import { getRowboatConfig } from "../config/rowboat.js";
import { selectInitialModel, selectInitialTaskModels } from "./initial-selection.js";
import { normalizeModelRecommendation } from "@x/shared/dist/rowboat-account.js";
import { capture } from "../analytics/posthog.js";

/**
 * Model-selection hooks for the ChatGPT-subscription (codex) sign-in
 * lifecycle. ChatGPT is a provider like any other: signing in connects it,
 * so it follows the same rules —
 *
 * - Connect with no saved assistant → pick an initial model (backend
 *   recommendation if the subscription lists it, else the first listed
 *   model) and save it. A saved assistant is NEVER replaced.
 * - Disconnect → drop the selections that reference the provider (same
 *   dangling-ref cleanup as removing any provider).
 */

export async function applyCodexInitialSelection(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    try {
        const cfg = await repo.getConfig().catch(() => null);
        if (cfg?.assistantModel) return; // saved choice — never replaced
        const catalog = await listCodexModels();
        const ids = catalog.providers[0]?.models.map((m) => m.id) ?? [];
        const recommendations = (await getRowboatConfig().catch(() => null))?.modelRecommendations;
        const model = selectInitialModel("codex", ids, recommendations);
        if (model) {
            // Task recommendations ride along the seeding moment (codex has
            // none today; the path is uniform across providers).
            const taskModels = selectInitialTaskModels("codex", "codex", ids, recommendations, model);
            await repo.updateConfig({
                assistantModel: { provider: "codex", model },
                ...(Object.keys(taskModels).length > 0 ? { taskModels } : {}),
            });
            capture("llm_initial_model_selected", {
                flavor: "codex",
                model,
                recommended: model === normalizeModelRecommendation(recommendations, "codex")?.assistantModel,
                task_overrides_seeded: Object.keys(taskModels).length,
                source: "sign_in",
            });
        }
    } catch (error) {
        // Best-effort: a failed initial selection must never break sign-in.
        console.warn("[models] Initial selection after ChatGPT sign-in failed:", error);
    }
}

export async function clearCodexSelections(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    try {
        // "codex" has no providers-map entry; removeProvider still clears
        // the assistantModel / task overrides that reference it.
        await repo.removeProvider("codex");
    } catch (error) {
        console.warn("[models] Clearing codex selections after sign-out failed:", error);
    }
}
