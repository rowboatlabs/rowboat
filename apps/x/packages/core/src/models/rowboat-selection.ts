import container from "../di/container.js";
import { IModelConfigRepo } from "./repo.js";
import { listGatewayModels } from "./gateway.js";
import { getRowboatConfig } from "../config/rowboat.js";
import { selectInitialModel } from "./initial-selection.js";

/**
 * Model-selection hooks for the Rowboat sign-in lifecycle. Signing in is
 * "connecting the rowboat provider", so it follows the same rules as any
 * provider connect:
 *
 * - Connect with no saved assistant → pick an initial model (backend
 *   recommendation if the gateway lists it, else the first listed model)
 *   and save it. A saved assistant is NEVER replaced — recommendations only
 *   ever choose the initial model.
 * - Disconnect → drop the selections that reference the provider (same
 *   dangling-reference cleanup as removing any provider).
 */

export async function applyRowboatInitialSelection(): Promise<void> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    try {
        const cfg = await repo.getConfig().catch(() => null);
        if (cfg?.assistantModel) return; // saved choice — never replaced
        const catalog = await listGatewayModels();
        const ids = catalog.providers[0]?.models.map((m) => m.id) ?? [];
        const recommendations = (await getRowboatConfig().catch(() => null))?.modelRecommendations;
        const model = selectInitialModel("rowboat", ids, recommendations);
        if (model) {
            await repo.updateConfig({ assistantModel: { provider: "rowboat", model } });
        }
    } catch (error) {
        // Best-effort: a failed initial selection must never break sign-in.
        // The picker copes with an unset assistant (shows the connect hint).
        console.warn("[models] Initial selection after Rowboat sign-in failed:", error);
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
