import { z } from "zod";

// Canonical reasoning-effort ladder, used everywhere effort appears: the
// per-provider default in models.json, the per-turn override on turn
// creation, and the persisted per-call parameters. Absence means "auto" —
// send nothing and let the provider default apply. Provider-specific
// syntax (OpenAI reasoningEffort, Anthropic thinking budgets, Gemini
// thinkingLevel, OpenRouter reasoning.effort) is mapped at invoke time.
export const ReasoningEffort = z.enum(["low", "medium", "high"]);

export const LlmProvider = z.object({
  flavor: z.enum(["openai", "anthropic", "google", "openrouter", "aigateway", "ollama", "openai-compatible", "rowboat"]),
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

// A provider-qualified model reference. `provider` is a provider name as
// understood by resolveProviderConfig — a BYOK flavor ("ollama", "openai",
// …) or "rowboat" for the signed-in gateway.
export const ModelRef = z.object({
  provider: z.string(),
  model: z.string(),
});

// Category overrides accept either a bare model id (legacy: paired with the
// active default provider) or a provider-qualified ref (hybrid mode: e.g.
// gateway assistant + local Ollama background agents).
export const ModelOverride = z.union([z.string(), ModelRef]);

export const LlmModelConfig = z.object({
  provider: LlmProvider,
  model: z.string(),
  models: z.array(z.string()).optional(),
  // The user's explicit default assistant model. When set it wins over both
  // the signed-in curated default and the legacy top-level provider/model
  // pair — this is what lets signed-in users default to a BYOK model.
  defaultSelection: ModelRef.optional(),
  // When true, background agent runs (knowledge pipeline, live notes,
  // background tasks) wait until no chat turn is running before starting.
  // Surfaced as a settings checkbox; recommended for local models, where a
  // background run competes with the chat for the same hardware.
  deferBackgroundTasks: z.boolean().optional(),
  providers: z.record(z.string(), z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    contextLength: z.number().int().positive().optional(),
    reasoningEffort: ReasoningEffort.optional(),
    model: z.string().optional(),
    models: z.array(z.string()).optional(),
    knowledgeGraphModel: z.string().optional(),
    meetingNotesModel: z.string().optional(),
    liveNoteAgentModel: z.string().optional(),
    autoPermissionDecisionModel: z.string().optional(),
  })).optional(),
  // Per-category model overrides. Honored in both modes: when unset,
  // signed-in users get the curated gateway defaults and BYOK users get the
  // assistant model. Read by helpers in core/models/defaults.ts.
  knowledgeGraphModel: ModelOverride.optional(),
  meetingNotesModel: ModelOverride.optional(),
  liveNoteAgentModel: ModelOverride.optional(),
  autoPermissionDecisionModel: ModelOverride.optional(),
  // Per-tier sub-agent models (the spawn-agent `tier` input). An unset tier
  // inherits the parent turn's model — the safe default in both modes.
  // Seeded once at Rowboat sign-in with curated suggestions (only when this
  // key is absent); user-overridable in settings afterwards.
  subagentModels: z.object({
    light: ModelRef.optional(),
    medium: ModelRef.optional(),
    heavy: ModelRef.optional(),
  }).optional(),
});
