import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { ModelSelection } from "@x/shared/dist/models.js";
import {
    computeRecommendationRows,
    patchForSlots,
    recommendationHash,
    type RecommendationRow,
    type RecommendationSlotKey,
} from "@x/shared/dist/recommendation-update.js";
import type { ModelRecommendations } from "@x/shared/dist/rowboat-account.js";
import container from "../di/container.js";
import { WorkDir } from "../config/config.js";
import { getRowboatConfig } from "../config/rowboat.js";
import { capture } from "../analytics/posthog.js";
import { IModelConfigRepo } from "./repo.js";
import { getModelCatalog } from "./catalog.js";

/**
 * The "Rowboat now recommends…" prompt: when the backend's recommendation
 * for the provider serving the assistant model changes, offer the user the
 * per-slot diff once, and never again for that version of the
 * recommendation.
 *
 * State is one marker per flavor — `seen[flavor] = hash` — in a small file
 * beside models.json (a UI-flow marker, not model config). The hash is the
 * content hash of the flavor's recommendation (shared/recommendation-update),
 * so the prompt reappears only when the recommendation itself changes; a
 * backend rollback hashes to a value already answered and stays quiet.
 *
 * `seen` is written on apply, on dismiss, and when a provider is first
 * connected (its initial selection already applied this version), so a
 * user who connected and then deliberately changed their model is not
 * nagged about the recommendation they already saw. A user who predates
 * this marker gets one prompt on their next launch if their config differs
 * — that is the intended catch-up.
 *
 * The check needs the provider's live model list (a recommendation the
 * provider does not list produces no row); a provider whose listing failed
 * yields no prompt and no marker, so the next launch retries.
 */

const STATE_FILE = path.join(WorkDir, "config", "model-recommendations.json");

const State = z.object({
    seen: z.record(z.string(), z.string()).default({}),
});
type State = z.infer<typeof State>;

async function loadState(): Promise<State> {
    try {
        return State.parse(JSON.parse(await fs.readFile(STATE_FILE, "utf8")));
    } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
            console.warn("[models] Could not read model-recommendations.json; treating as empty:", err);
        }
        return { seen: {} };
    }
}

async function saveState(state: State): Promise<void> {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, STATE_FILE);
}

async function markSeen(flavor: string, hash: string): Promise<void> {
    const state = await loadState();
    if (state.seen[flavor] === hash) return;
    await saveState({ seen: { ...state.seen, [flavor]: hash } });
}

async function currentRecommendations(): Promise<ModelRecommendations | undefined> {
    return (await getRowboatConfig().catch(() => null))?.modelRecommendations;
}

/**
 * Record that the user has been offered this flavor's current
 * recommendation — called at the seeding moment (provider connect / Rowboat
 * sign-in), where initial selection just applied it. Best-effort: a failure
 * here means at worst one extra prompt later.
 */
export async function markRecommendationSeen(flavor: string): Promise<void> {
    try {
        const hash = recommendationHash(await currentRecommendations(), flavor);
        if (hash) await markSeen(flavor, hash);
    } catch (error) {
        console.warn(`[models] Could not record recommendation as seen for ${flavor}:`, error);
    }
}

export type RecommendationUpdate = {
    flavor: string;
    providerId: string;
    hash: string;
    /** The assistant as saved now — renders "Same as Assistant (X)" for inherit rows. */
    assistantModel: z.infer<typeof ModelSelection>;
    rows: RecommendationRow[];
};

export type RecommendationUpdateCheck =
    | { shouldShow: false }
    | ({ shouldShow: true } & RecommendationUpdate);

/**
 * The pending update for the assistant's provider, or nothing. Pure with
 * respect to state except in one case: a recommendation the config already
 * matches is recorded as seen so the catalog isn't re-listed on every
 * launch for a prompt that can never appear.
 */
async function computeUpdate(): Promise<RecommendationUpdate | null> {
    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const cfg = await repo.getConfig().catch(() => null);
    const assistantModel = cfg?.assistantModel;
    if (!cfg || !assistantModel) return null;

    const providerId = assistantModel.provider;
    const flavor = providerId === "rowboat" || providerId === "codex"
        ? providerId
        : cfg.providers[providerId]?.flavor;
    if (!flavor) return null;

    const recommendations = await currentRecommendations();
    const hash = recommendationHash(recommendations, flavor);
    if (!hash) return null;

    const state = await loadState();
    if (state.seen[flavor] === hash) return null;

    const catalog = await getModelCatalog();
    const entry = catalog.providers.find((p) => p.id === providerId);
    if (!entry || entry.status !== "ok") return null;

    const rows = computeRecommendationRows({
        providerId,
        flavor,
        availableModelIds: entry.models.map((m) => m.id),
        recommendations,
        assistantModel,
        taskModels: cfg.taskModels ?? {},
    });
    if (rows.length === 0) {
        await markSeen(flavor, hash);
        return null;
    }
    return { flavor, providerId, hash, assistantModel, rows };
}

export async function checkRecommendationUpdate(): Promise<RecommendationUpdateCheck> {
    try {
        const update = await computeUpdate();
        if (!update) return { shouldShow: false };
        capture("llm_recommendation_update_shown", {
            flavor: update.flavor,
            recommendation_hash: update.hash,
            row_count: update.rows.length,
            slots: update.rows.map((r) => r.slot),
        });
        return { shouldShow: true, ...update };
    } catch (error) {
        // Best-effort: the prompt must never break launch.
        console.warn("[models] Recommendation update check failed:", error);
        return { shouldShow: false };
    }
}

/**
 * The user's answer to the prompt: `apply` lists the checked slots (empty =
 * "Not now"). Rows are recomputed from a fresh config + catalog read and
 * only checked slots still proposing the same change are written, so a
 * stale dialog can't clobber an edit made while it was open. The flavor's
 * hash is recorded as seen either way.
 */
export async function resolveRecommendationUpdate(args: {
    flavor: string;
    hash: string;
    apply: RecommendationSlotKey[];
}): Promise<{ applied: RecommendationSlotKey[] }> {
    const applied: RecommendationSlotKey[] = [];
    try {
        if (args.apply.length > 0) {
            const update = await computeUpdate();
            if (update && update.flavor === args.flavor && update.hash === args.hash) {
                const patch = patchForSlots(update.rows, args.apply);
                if (patch.assistantModel || patch.taskModels) {
                    const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
                    await repo.updateConfig(patch);
                    for (const row of update.rows) {
                        if (args.apply.includes(row.slot)) applied.push(row.slot);
                    }
                }
            }
        }
    } finally {
        await markSeen(args.flavor, args.hash).catch((error) => {
            console.warn(`[models] Could not record recommendation as seen for ${args.flavor}:`, error);
        });
    }
    capture(applied.length > 0 ? "llm_recommendation_update_applied" : "llm_recommendation_update_dismissed", {
        flavor: args.flavor,
        recommendation_hash: args.hash,
        requested_slots: args.apply,
        applied_slots: applied,
    });
    return { applied };
}
