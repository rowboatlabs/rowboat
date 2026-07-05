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

export const LlmModelConfig = z.object({
  provider: LlmProvider,
  model: z.string(),
  models: z.array(z.string()).optional(),
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
  // Per-category model overrides (BYOK only — signed-in users always get
  // the curated gateway defaults). Read by helpers in core/models/defaults.ts.
  knowledgeGraphModel: z.string().optional(),
  meetingNotesModel: z.string().optional(),
  liveNoteAgentModel: z.string().optional(),
  autoPermissionDecisionModel: z.string().optional(),
});
