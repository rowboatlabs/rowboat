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

// The per-task model override slots. Absence = inherit the assistant model.
export const TaskModels = z.object({
  knowledgeGraph: ModelRef.optional(),
  meetingNotes: ModelRef.optional(),
  liveNoteAgent: ModelRef.optional(),
  autoPermissionDecision: ModelRef.optional(),
  chatTitle: ModelRef.optional(),
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
  // picked. Absent only before onboarding / first provider connect.
  assistantModel: ModelRef.optional(),
  taskModels: TaskModels.optional(),
  // When true, background agent runs (knowledge pipeline, live notes,
  // background tasks) wait until no chat turn is running before starting.
  // Surfaced as a settings checkbox; recommended for local models, where a
  // background run competes with the chat for the same hardware.
  deferBackgroundTasks: z.boolean().optional(),
});
