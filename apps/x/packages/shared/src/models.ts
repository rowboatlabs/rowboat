import { z } from "zod";

// Canonical reasoning-effort ladder, used everywhere effort appears: the
// per-provider default in models.json, the per-turn override on turn
// creation, and the persisted per-call parameters. Absence means "auto" —
// send nothing and let the provider default apply. Provider-specific
// syntax (OpenAI reasoningEffort, Anthropic thinking budgets, Gemini
// thinkingLevel, OpenRouter reasoning.effort) is mapped at invoke time.
export const ReasoningEffort = z.enum(["low", "medium", "high"]);

// A provider entry: its TYPE (flavor) plus credentials and connection
// preferences. Deliberately carries NO model fields — model lists are always
// fetched from the provider (core/models/catalog.ts), and model choices live
// in assistantModel / taskModels.
export const LlmProvider = z.object({
  // "rowboat" (signed-in gateway) and "codex" (ChatGPT subscription via
  // "Sign in with ChatGPT") are credential-less flavors: they never appear
  // in models.json's providers map — auth lives in their own token stores.
  flavor: z.enum(["openai", "anthropic", "google", "openrouter", "aigateway", "ollama", "openai-compatible", "rowboat", "codex"]),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  // Context window (in tokens) to request from local runtimes. Ollama defaults
  // to a ~4k window that silently truncates Rowboat's prompts; when unset,
  // local providers get a larger default (see core/models/local.ts).
  contextLength: z.number().int().positive().optional(),
  // Default reasoning effort for this provider. For Ollama this drives the
  // `think` parameter (gpt-oss takes the levels directly; other thinking
  // models map low → off, high → on; defaults to "low" — background agents
  // and chat both want snappy responses on local hardware). For cloud
  // providers it seeds the per-turn effort when the user hasn't chosen one.
  reasoningEffort: ReasoningEffort.optional(),
});

// A provider-qualified model reference. `provider` is a provider INSTANCE id
// as understood by resolveProviderConfig — a key of the providers map, or
// "rowboat" / "codex" for the credential-less providers. Today one instance
// exists per flavor, so instance ids equal flavor keys.
export const ModelRef = z.object({
  provider: z.string(),
  model: z.string(),
});

// Stored effort is lenient on read: missing, null, and "auto" all mean Auto
// (send nothing; provider default) and normalize to `undefined`. Writers
// emit the canonical form — the key omitted when Auto.
export const StoredReasoningEffort = z
  .union([ReasoningEffort, z.literal("auto"), z.null(), z.undefined()])
  .transform((v) => (v === "auto" || v === null ? undefined : v));

// A model choice as stored in config: the ref plus the reasoning effort the
// user picked with it. Model and effort are selected together in the picker
// and treated as one explicit pair everywhere — Auto (absent effort) means
// the user picked Auto. Runs seeded from a choice use its effort verbatim;
// there is no cross-level effort inference.
export const ModelSelection = ModelRef.extend({
  effort: StoredReasoningEffort.optional(),
});

// The per-task model override slots. Absence = inherit the assistant model
// (except `subagent`, whose default is the PARENT turn's model — which is
// the assistant for a top-level chat). An override carries its own effort;
// inheriting the assistant model inherits the assistant's effort with it.
export const TaskModels = z.object({
  knowledgeGraph: ModelSelection.optional(),
  meetingNotes: ModelSelection.optional(),
  liveNoteAgent: ModelSelection.optional(),
  autoPermissionDecision: ModelSelection.optional(),
  chatTitle: ModelSelection.optional(),
  backgroundTask: ModelSelection.optional(),
  subagent: ModelSelection.optional(),
});
export type TaskModelKey = keyof z.infer<typeof TaskModels>;

/**
 * models.json, version 2.
 *
 * The design: providers carry credentials only (keyed by instance id, with
 * the flavor explicit inside each entry); model choices live in exactly two
 * places — the required-once-configured `assistantModel`, and optional
 * per-task overrides that otherwise inherit from it. Model LISTS are never
 * stored: they are fetched live per provider by the unified catalog.
 *
 * Version 1 (top-level provider/model pair + per-provider model lists +
 * defaultSelection + flat category overrides) is migrated on boot by
 * core/models/migrate.ts and its schema lives there.
 */
export const LlmModelConfig = z.object({
  version: z.literal(2),
  providers: z.record(z.string(), LlmProvider),
  // The one primary model choice: what runs when nothing more specific was
  // picked, and what seeds a new chat's composer (model + effort shown as
  // the explicit initial selection). Absent only before onboarding / first
  // provider connect.
  assistantModel: ModelSelection.optional(),
  taskModels: TaskModels.optional(),
  // The image-generation model (the generate-image tool). Its own slot
  // rather than a taskModels override because it cannot inherit the
  // assistant — that is a text model — and a bare ref rather than a
  // ModelSelection because image models take no reasoning effort. Seeded
  // with the gateway's image model on Rowboat sign-in; while absent the
  // tool is unavailable until one is picked in model settings.
  imageModel: ModelRef.optional(),
  // When true, background agent runs (knowledge pipeline, live notes,
  // background tasks) wait until no chat turn is running before starting.
  // Surfaced as a settings checkbox; recommended for local models, where a
  // background run competes with the chat for the same hardware.
  deferBackgroundTasks: z.boolean().optional(),
});

// BAARALI(03/10/2026): a model's place in the picker, as the control plane
// sends it on /v1/llm/models (apps/baarali control model-access.ts).
export const BaaraliModelMeta = z.object({
  vendor: z.string(),
  vendorName: z.string(),
  vendorRank: z.number(),
  strength: z.string(),
  recommended: z.boolean(),
  // The plan that opens it; set: shown with a padlock, not selectable.
  unlock: z.string().optional(),
});
export type BaaraliModelMeta = z.infer<typeof BaaraliModelMeta>;

/**
 * BAARALI(03/10/2026): a picker's models sorted by vendor, as the control
 * plane describes them (apps/baarali control model-access.ts, pickerGroups):
 * one section per vendor in the catalog's order; inside, « Conseillé » first,
 * then what the plan opens, then what it padlocks, each by name. Items
 * without a description go last, in a section with an empty vendor. null when
 * none is described (another provider): the picker keeps its own layout.
 */
export function vendorSections<T>(
  items: T[],
  metaOf: (item: T) => BaaraliModelMeta | undefined,
  nameOf: (item: T) => string,
): Array<{ vendor: string; name: string; items: T[] }> | null {
  if (!items.some((i) => metaOf(i))) return null;
  const sections = new Map<string, { rank: number; name: string; items: T[] }>();
  const rest: T[] = [];
  for (const item of items) {
    const meta = metaOf(item);
    if (!meta) {
      rest.push(item);
      continue;
    }
    const section = sections.get(meta.vendor) ?? { rank: meta.vendorRank, name: meta.vendorName, items: [] };
    section.items.push(item);
    sections.set(meta.vendor, section);
  }
  const place = (item: T) => {
    const meta = metaOf(item)!;
    return meta.unlock ? 2 : meta.recommended ? 0 : 1;
  };
  const sorted = [...sections.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([vendor, s]) => ({
      vendor,
      name: s.name,
      items: [...s.items].sort((a, b) => place(a) - place(b) || nameOf(a).localeCompare(nameOf(b))),
    }));
  return rest.length ? [...sorted, { vendor: '', name: '', items: rest }] : sorted;
}
