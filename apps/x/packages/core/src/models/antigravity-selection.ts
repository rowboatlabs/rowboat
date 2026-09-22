import container from "../di/container.js";
import { IModelConfigRepo } from "./repo.js";
import { listAntigravityModels } from "./antigravity.js";
import { getRowboatConfig } from "../config/rowboat.js";
import { selectInitialModel, selectInitialTaskModels } from "./initial-selection.js";
import { normalizeModelRecommendation } from "@x/shared/dist/rowboat-account.js";
import { capture } from "../analytics/posthog.js";

/**
 * Model-selection hooks for the Antigravity (Google) sign-in lifecycle.
 * Antigravity is a provider like any other: signing in connects it, so it
 * follows the same rules as the codex flavor —
 *
 * - Connect with no saved assistant → pick an initial model (backend
 *   recommendation if the gateway lists it, else the first listed model) and
 *   save it. A saved assistant is NEVER replaced.
 * - Disconnect → drop the selections that reference the provider (same
 *   dangling-ref cleanup as removing any provider).
 */

export async function applyAntigravityInitialSelection(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    try {
        const cfg = await repo.getConfig().catch(() => null);
        if (cfg?.assistantModel) return; // saved choice — never replaced
        const catalog = await listAntigravityModels();
        const ids = catalog.providers[0]?.models.map((m) => m.id) ?? [];
        const recommendations = (await getRowboatConfig().catch(() => null))?.modelRecommendations;
        const choice = selectInitialModel("antigravity", ids, recommendations);
        if (choice) {
            const taskModels = selectInitialTaskModels("antigravity", "antigravity", ids, recommendations, choice);
            await repo.updateConfig({
                assistantModel: {
                    provider: "antigravity",
                    model: choice.model,
                    ...(choice.effort ? { effort: choice.effort } : {}),
                },
                ...(Object.keys(taskModels).length > 0 ? { taskModels } : {}),
            });
            capture("llm_initial_model_selected", {
                flavor: "antigravity",
                model: choice.model,
                recommended: choice.model === normalizeModelRecommendation(recommendations, "antigravity")?.assistantModel.model,
                task_overrides_seeded: Object.keys(taskModels).length,
                source: "sign_in",
            });
        }
    } catch (error) {
        // Best-effort: a failed initial selection must never break sign-in.
        console.warn("[models] Initial selection after Antigravity sign-in failed:", error);
    }
}

export async function clearAntigravitySelections(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    try {
        // "antigravity" has no providers-map entry; removeProvider still
        // clears the assistantModel / task overrides that reference it.
        await repo.removeProvider("antigravity");
    } catch (error) {
        console.warn("[models] Clearing antigravity selections after sign-out failed:", error);
    }
}
