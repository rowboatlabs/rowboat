import container from "../di/container.js";
import { IModelConfigRepo } from "./repo.js";
import { listGatewayModels } from "./gateway.js";
import { getRowboatConfig } from "../config/rowboat.js";
import { selectInitialModel, selectInitialTaskModels } from "./initial-selection.js";
import { AUTO_MODEL_ID } from "@x/shared/dist/models.js";
import { normalizeModelRecommendation } from "@x/shared/dist/rowboat-account.js";
import { capture } from "../analytics/posthog.js";

/**
 * Model-selection hooks for the Rowboat sign-in lifecycle. Signing in is
 * "connecting the rowboat provider", so it follows the same rules as any
 * provider connect:
 *
 * - Connect with no saved assistant → pick an initial model (backend
 *   recommendation if the gateway lists it, else the first listed model)
 *   and save it. When the backend's autoModelDefault rollout flag is on,
 *   the initial pick is the Auto sentinel instead — resolved per run by
 *   core/models/auto.ts. A saved assistant is NEVER replaced —
 *   recommendations only ever choose the initial model.
 * - Connect with no saved image model → seed the gateway's image model.
 *   Its own guard, not the assistant's: the image model cannot inherit the
 *   assistant (a text model), so a BYOK user who already has an assistant
 *   still gets an image model from signing in. Never replaced either.
 * - Disconnect → drop the selections that reference the provider (same
 *   dangling-reference cleanup as removing any provider).
 */

// The gateway's image model, seeded as the generate-image default. The
// gateway's image allowlist (GET /v1/llm/models?output_modalities=image) is
// the source of truth for what it serves; this is its official default.
export const ROWBOAT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

export async function applyRowboatInitialSelection(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const cfg = await repo.getConfig().catch(() => null);
    await seedAssistantModel(repo, cfg);
    await seedImageModel(repo, cfg);
}

type Config = Awaited<ReturnType<IModelConfigRepo["getConfig"]>>;

async function seedAssistantModel(repo: IModelConfigRepo, cfg: Config | null): Promise<void> {
    try {
        if (cfg?.assistantModel) return; // saved choice — never replaced
        const rowboatConfig = await getRowboatConfig().catch(() => null);
        if (rowboatConfig?.features?.autoModelDefault) {
            // Rollout-flagged Auto default: seed the sentinel instead of a
            // pinned model, and skip materializing task overrides — Auto
            // resolution is category-aware, so the per-task recommendations
            // keep steering background work without frozen copies. An older
            // backend (no features block) keeps the pinning path below.
            await repo.updateConfig({
                assistantModel: { provider: "rowboat", model: AUTO_MODEL_ID },
            });
            capture("llm_initial_model_selected", {
                flavor: "rowboat",
                model: AUTO_MODEL_ID,
                auto_default: true,
                task_overrides_seeded: 0,
                source: "sign_in",
            });
            return;
        }
        const catalog = await listGatewayModels();
        const ids = catalog.providers[0]?.models.map((m) => m.id) ?? [];
        const recommendations = rowboatConfig?.modelRecommendations;
        const choice = selectInitialModel("rowboat", ids, recommendations);
        if (choice) {
            // Task recommendations ride along the seeding moment: the
            // gateway's lite-tier task models become visible overrides so
            // always-on background work doesn't run on assistant-class
            // models (plan-credit economics).
            const taskModels = selectInitialTaskModels("rowboat", "rowboat", ids, recommendations, choice);
            await repo.updateConfig({
                assistantModel: {
                    provider: "rowboat",
                    model: choice.model,
                    ...(choice.effort ? { effort: choice.effort } : {}),
                },
                ...(Object.keys(taskModels).length > 0 ? { taskModels } : {}),
            });
            // Measures recommendation quality: hit = the backend's pick was
            // in the gateway list; miss = first-listed fallback.
            capture("llm_initial_model_selected", {
                flavor: "rowboat",
                model: choice.model,
                recommended: choice.model === normalizeModelRecommendation(recommendations, "rowboat")?.assistantModel.model,
                task_overrides_seeded: Object.keys(taskModels).length,
                source: "sign_in",
            });
        }
    } catch (error) {
        // Best-effort: a failed initial selection must never break sign-in.
        // The picker copes with an unset assistant (shows the connect hint).
        console.warn("[models] Initial selection after Rowboat sign-in failed:", error);
    }
}

async function seedImageModel(repo: IModelConfigRepo, cfg: Config | null): Promise<void> {
    try {
        if (cfg?.imageModel) return; // saved choice — never replaced
        await repo.updateConfig({
            imageModel: { provider: "rowboat", model: ROWBOAT_IMAGE_MODEL },
        });
    } catch (error) {
        // Best-effort, same as the assistant: generate-image stays
        // unavailable until a model is picked in settings.
        console.warn("[models] Seeding the image model after Rowboat sign-in failed:", error);
    }
}

export async function clearRowboatSelections(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    try {
        // "rowboat" has no providers-map entry; removeProvider still clears
        // the assistantModel / task overrides that reference it.
        await repo.removeProvider("rowboat");
    } catch (error) {
        console.warn("[models] Clearing Rowboat selections after sign-out failed:", error);
    }
}
