import { z } from "zod";

export const LlmProvider = z.object({
  flavor: z.enum(["openai", "anthropic", "google", "openrouter", "aigateway", "ollama", "openai-compatible", "rowboat"]),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  // Context window (in tokens) to request from local runtimes. Ollama defaults
  // to a ~4k window that silently truncates Rowboat's prompts; when unset,
  // local providers get a larger default (see core/models/local.ts).
  contextLength: z.number().int().positive().optional(),
  // Reasoning effort for local thinking models (Ollama `think` parameter).
  // gpt-oss supports the levels directly; other thinking models map
  // low → thinking off, high → thinking on. Defaults to "low" for Ollama —
  // background agents and chat both want snappy responses on local hardware.
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
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
  // Per-category model overrides. Honored in both modes: when unset,
  // signed-in users get the curated gateway defaults and BYOK users get the
  // assistant model. Read by helpers in core/models/defaults.ts.
  knowledgeGraphModel: ModelOverride.optional(),
  meetingNotesModel: ModelOverride.optional(),
  liveNoteAgentModel: ModelOverride.optional(),
  autoPermissionDecisionModel: ModelOverride.optional(),
});
