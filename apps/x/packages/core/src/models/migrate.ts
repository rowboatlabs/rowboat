import { z } from "zod";
import { LlmModelConfig, LlmProvider, ModelRef } from "@x/shared/dist/models.js";

/**
 * One-time migration of models.json from version 1 to version 2.
 *
 * v1 accreted three generations of schema: a top-level provider/model pair
 * (the original single-provider config), a providers map whose entries
 * duplicated credentials AND carried saved model lists (pre-dynamic-listing
 * picker caches), plus `defaultSelection` and flat category overrides bolted
 * on for hybrid mode. On top of that, several effective models existed only
 * as hidden branches in code (the signed-in curated defaults).
 *
 * v2 stores providers as credentials-only entries and model choices in
 * exactly two places: `assistantModel` and `taskModels`. This migration
 * evaluates the OLD resolution rules one last time and writes their answers
 * down explicitly, so the simplified v2 resolvers produce identical
 * effective models for every existing user. Task overrides are written ONLY
 * where the old effective model differs from plain inherit-from-assistant.
 *
 * The curated model ids below are FROZEN COPIES of the v1 constants that
 * lived in defaults.ts (deleted with this migration). They are historical
 * data, not live configuration — do not update them when recommendations
 * change.
 */

const V1_SIGNED_IN_ASSISTANT: z.infer<typeof ModelRef> = { provider: "rowboat", model: "google/gemini-3.5-flash" };
const V1_CURATED_LITE = "google/gemini-3.1-flash-lite";
const V1_CURATED_CHAT_TITLE = "google/gemini-3.5-flash-lite";

// v1 schema — kept here, and only here, for the migration reader.
const ModelOverrideV1 = z.union([z.string(), ModelRef]);
export const LlmModelConfigV1 = z.object({
  provider: LlmProvider,
  model: z.string(),
  models: z.array(z.string()).optional(),
  defaultSelection: ModelRef.optional(),
  deferBackgroundTasks: z.boolean().optional(),
  providers: z.record(z.string(), z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    contextLength: z.number().int().positive().optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    model: z.string().optional(),
    models: z.array(z.string()).optional(),
    knowledgeGraphModel: z.string().optional(),
    meetingNotesModel: z.string().optional(),
    liveNoteAgentModel: z.string().optional(),
    autoPermissionDecisionModel: z.string().optional(),
  })).optional(),
  knowledgeGraphModel: ModelOverrideV1.optional(),
  meetingNotesModel: ModelOverrideV1.optional(),
  liveNoteAgentModel: ModelOverrideV1.optional(),
  autoPermissionDecisionModel: ModelOverrideV1.optional(),
  chatTitleModel: ModelOverrideV1.optional(),
});

type V2 = z.infer<typeof LlmModelConfig>;
type Ref = z.infer<typeof ModelRef>;

function sameRef(a: Ref | undefined, b: Ref | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.model === b.model;
}

function asRef(value: unknown): Ref | undefined {
  const parsed = ModelRef.safeParse(value);
  return parsed.success && parsed.data.model ? parsed.data : undefined;
}

/**
 * Resolve a v1 category override the way defaults.ts used to: a bare string
 * pairs with the top-level provider flavor; a ref is used as-is except a
 * "rowboat" ref while signed out (needs auth → was skipped).
 */
function v1Override(raw: Record<string, unknown>, key: string, signedIn: boolean): Ref | undefined {
  const value = raw[key];
  if (typeof value === "string" && value) {
    const flavor = (raw.provider as Record<string, unknown> | undefined)?.flavor;
    return typeof flavor === "string" && flavor ? { provider: flavor, model: value } : undefined;
  }
  const ref = asRef(value);
  if (ref && (ref.provider !== "rowboat" || signedIn)) return ref;
  return undefined;
}

/** The old effective assistant model (defaults.ts resolution order). */
function v1EffectiveAssistant(raw: Record<string, unknown>, signedIn: boolean): Ref | undefined {
  const selection = asRef(raw.defaultSelection);
  if (selection && (selection.provider !== "rowboat" || signedIn)) return selection;
  if (signedIn) return V1_SIGNED_IN_ASSISTANT;
  const flavor = (raw.provider as Record<string, unknown> | undefined)?.flavor;
  const model = raw.model;
  if (typeof flavor === "string" && flavor && typeof model === "string" && model) {
    return { provider: flavor, model };
  }
  return undefined;
}

/**
 * Migrate a raw parsed models.json (any shape) to v2. Returns null when the
 * input is already v2 — nothing to do.
 *
 * Pure: sign-in state is an input; no I/O.
 */
export function migrateModelsConfig(rawInput: unknown, signedIn: boolean): V2 | null {
  const raw = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  if (raw.version === 2) return null;

  // Providers: map entries with some credential survive, stripped to
  // credentials + connection prefs. The top-level pair is merged in for
  // very old configs that predate the providers map.
  const providers: V2["providers"] = {};
  const candidateEntries: Array<[string, unknown]> = Object.entries(
    (raw.providers && typeof raw.providers === "object" ? raw.providers : {}) as Record<string, unknown>,
  );
  const topLevel = raw.provider as Record<string, unknown> | undefined;
  if (topLevel && typeof topLevel.flavor === "string" && !candidateEntries.some(([k]) => k === topLevel.flavor)) {
    candidateEntries.push([topLevel.flavor, topLevel]);
  }
  for (const [id, value] of candidateEntries) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const apiKey = typeof entry.apiKey === "string" ? entry.apiKey.trim() : "";
    const baseURL = typeof entry.baseURL === "string" ? entry.baseURL.trim() : "";
    if (!apiKey && !baseURL) continue; // never connected
    const parsed = LlmProvider.safeParse({ ...entry, flavor: id });
    if (parsed.success) providers[id] = parsed.data;
  }

  const assistantModel = v1EffectiveAssistant(raw, signedIn);

  // Old effective model per task, via the deleted v1 rules.
  const liveNoteEffective = v1Override(raw, "liveNoteAgentModel", signedIn)
    ?? (signedIn ? { provider: "rowboat", model: V1_CURATED_LITE } : assistantModel);
  const oldTaskModels: Record<string, Ref | undefined> = {
    knowledgeGraph: v1Override(raw, "knowledgeGraphModel", signedIn)
      ?? (signedIn ? { provider: "rowboat", model: V1_CURATED_LITE } : assistantModel),
    liveNoteAgent: liveNoteEffective,
    // v1 had no backgroundTask key — getBackgroundTaskAgentModel mirrored
    // the live-note model (override included). v2 gives it its own slot.
    backgroundTask: liveNoteEffective,
    autoPermissionDecision: v1Override(raw, "autoPermissionDecisionModel", signedIn)
      ?? (signedIn ? { provider: "rowboat", model: V1_CURATED_LITE } : assistantModel),
    meetingNotes: v1Override(raw, "meetingNotesModel", signedIn)
      ?? (signedIn ? V1_SIGNED_IN_ASSISTANT : assistantModel),
    // Chat titles used the curated lite model ONLY when the assistant itself
    // routed through the gateway (the exhausted-gateway safeguard).
    chatTitle: v1Override(raw, "chatTitleModel", signedIn)
      ?? (assistantModel?.provider === "rowboat"
        ? { provider: "rowboat", model: V1_CURATED_CHAT_TITLE }
        : assistantModel),
  };

  // Write an override only where the old effective model differs from what
  // v2 inheritance (assistant) would produce.
  const taskModels: NonNullable<V2["taskModels"]> = {};
  for (const [key, ref] of Object.entries(oldTaskModels)) {
    if (ref && !sameRef(ref, assistantModel)) {
      taskModels[key as keyof typeof taskModels] = ref;
    }
  }

  return {
    version: 2,
    providers,
    ...(assistantModel ? { assistantModel } : {}),
    ...(Object.keys(taskModels).length > 0 ? { taskModels } : {}),
    ...(raw.deferBackgroundTasks === true ? { deferBackgroundTasks: true } : {}),
  };
}
