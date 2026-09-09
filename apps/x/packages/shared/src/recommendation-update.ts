import { z } from "zod";
import { ModelSelection, TaskModels } from "./models.js";
import {
    normalizeModelRecommendation,
    type ModelRecommendations,
    type NormalizedModelRecommendation,
    type RecommendedModelChoice,
} from "./rowboat-account.js";

/**
 * Recommendation UPDATES: the pure half of the "Rowboat now recommends…"
 * prompt (core/models/recommendation-update.ts owns state and IPC).
 *
 * Initial selection (initial-selection.ts) seeds a provider's models once,
 * at connect time. After that the saved config is the source of truth and
 * a changed backend recommendation must never be applied silently. This
 * module turns a changed recommendation into an explicit, per-slot
 * proposal the user can accept row by row:
 *
 * - `recommendationHash` identifies one flavor's recommendation by CONTENT
 *   (normalized, so the legacy bare-string and object wire shapes hash the
 *   same). The prompt is offered once per hash: the user's accept/dismiss
 *   is recorded against it, and a backend rollback hashes back to a value
 *   they already answered.
 * - `computeRecommendationRows` diffs the recommendation against the saved
 *   config for the provider currently serving the assistant, one row per
 *   slot that would change. Task slots pointing at a DIFFERENT provider are
 *   left alone (the recommendation is about this provider's slots, not a
 *   nudge to move providers); a recommended model the provider does not
 *   list produces no row (a stale hint, same rule as initial selection).
 * - `patchForSlots` turns the rows the user checked into a config patch.
 */

export const RecommendationSlot = z.enum([
    "assistantModel",
    "knowledgeGraph",
    "meetingNotes",
    "liveNoteAgent",
    "autoPermissionDecision",
    "chatTitle",
    "backgroundTask",
    "subagent",
]);
export type RecommendationSlotKey = z.infer<typeof RecommendationSlot>;

const TASK_SLOTS = Object.keys(TaskModels.shape) as Array<keyof z.infer<typeof TaskModels>>;
// Compile-time guard: every task slot is a recommendation slot and vice versa.
type _TaskSlotsCovered = Exclude<keyof z.infer<typeof TaskModels>, RecommendationSlotKey> extends never ? true : never;
type _NoExtraSlots = Exclude<RecommendationSlotKey, "assistantModel" | keyof z.infer<typeof TaskModels>> extends never ? true : never;
const _slotGuards: [_TaskSlotsCovered, _NoExtraSlots] = [true, true];
void _slotGuards;

type Selection = z.infer<typeof ModelSelection>;

export interface RecommendationRow {
    slot: RecommendationSlotKey;
    /** What the slot resolves to now; null on a task slot = inherits the assistant. */
    current: Selection | null;
    /** What the recommendation proposes; null on a task slot = inherit the assistant. */
    recommended: Selection | null;
}

export const RecommendationRowSchema = z.object({
    slot: RecommendationSlot,
    current: ModelSelection.nullable(),
    recommended: ModelSelection.nullable(),
});

/**
 * Content hash of one flavor's recommendation in canonical form; null when
 * the flavor has none. FNV-1a over a key-sorted JSON encoding — this only
 * needs to be stable and collision-free across the handful of values a
 * backend will ever serve, not cryptographic.
 */
export function recommendationHash(
    recommendations: ModelRecommendations | undefined,
    flavor: string,
): string | null {
    const normalized = normalizeModelRecommendation(recommendations, flavor);
    if (!normalized) return null;
    const canonical = JSON.stringify({
        assistantModel: canonicalChoice(normalized.assistantModel),
        taskModels: Object.keys(normalized.taskModels).sort().map((key) => [
            key,
            canonicalChoice(normalized.taskModels[key]!),
        ]),
    });
    return fnv1a(canonical);
}

function canonicalChoice(choice: RecommendedModelChoice): [string, string] {
    return [choice.model, choice.effort ?? ""];
}

function fnv1a(input: string): string {
    // 32-bit FNV-1a, two passes with different offsets folded into one
    // 16-hex-char string, so a one-character change flips both halves.
    let h1 = 0x811c9dc5;
    let h2 = 0x050c5d1f;
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export interface RecommendationRowsInput {
    /** Provider INSTANCE id the assistant model points at. */
    providerId: string;
    /** That provider's flavor (keys the recommendations map). */
    flavor: string;
    /** The provider's live model list; a recommendation outside it is ignored. */
    availableModelIds: string[];
    recommendations: ModelRecommendations | undefined;
    assistantModel: Selection;
    taskModels: Partial<Record<keyof z.infer<typeof TaskModels>, Selection | null | undefined>>;
}

export function computeRecommendationRows(input: RecommendationRowsInput): RecommendationRow[] {
    const { providerId, flavor, availableModelIds, assistantModel, taskModels } = input;
    if (assistantModel.provider !== providerId) return [];
    const rec = normalizeModelRecommendation(input.recommendations, flavor);
    if (!rec) return [];

    const rows: RecommendationRow[] = [];
    const listed = new Set(availableModelIds);

    if (listed.has(rec.assistantModel.model)) {
        const recommended = toSelection(providerId, rec.assistantModel);
        if (!sameChoice(assistantModel, recommended)) {
            rows.push({ slot: "assistantModel", current: assistantModel, recommended });
        }
    }

    for (const key of TASK_SLOTS) {
        const current = taskModels[key] ?? null;
        // An override on another provider is a deliberate choice outside
        // this recommendation's scope.
        if (current && current.provider !== providerId) continue;
        const proposal = taskProposal(rec, key, listed, providerId);
        if (proposal === "unusable") continue;
        if (current === null && proposal === null) continue;
        if (current && proposal && sameChoice(current, proposal)) continue;
        rows.push({ slot: key, current, recommended: proposal });
    }

    return rows;
}

/**
 * What the recommendation says a task slot should be: an explicit
 * override, `null` = inherit the assistant (the task is absent from the
 * recommendation, or equals its assistant pick — the same rule initial
 * selection applies), or "unusable" when the recommended model is not in
 * the provider's list.
 */
function taskProposal(
    rec: NormalizedModelRecommendation,
    key: keyof z.infer<typeof TaskModels>,
    listed: Set<string>,
    providerId: string,
): Selection | null | "unusable" {
    const choice = rec.taskModels[key];
    if (!choice) return null;
    if (choice.model === rec.assistantModel.model && choice.effort === rec.assistantModel.effort) return null;
    if (!listed.has(choice.model)) return "unusable";
    return toSelection(providerId, choice);
}

function toSelection(providerId: string, choice: RecommendedModelChoice): Selection {
    return { provider: providerId, model: choice.model, ...(choice.effort ? { effort: choice.effort } : {}) };
}

function sameChoice(a: Selection, b: Selection): boolean {
    return a.provider === b.provider && a.model === b.model && (a.effort ?? undefined) === (b.effort ?? undefined);
}

export interface RecommendationPatch {
    assistantModel?: Selection;
    taskModels?: Partial<Record<keyof z.infer<typeof TaskModels>, Selection | null>>;
}

/** The config patch that applies exactly the checked rows (null = clear the override so it inherits). */
export function patchForSlots(rows: RecommendationRow[], slots: RecommendationSlotKey[]): RecommendationPatch {
    const wanted = new Set(slots);
    const patch: RecommendationPatch = {};
    for (const row of rows) {
        if (!wanted.has(row.slot)) continue;
        if (row.slot === "assistantModel") {
            if (row.recommended) patch.assistantModel = row.recommended;
            continue;
        }
        patch.taskModels = { ...(patch.taskModels ?? {}), [row.slot]: row.recommended };
    }
    return patch;
}
