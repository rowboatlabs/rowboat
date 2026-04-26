import { z } from "zod";

export const LlmProvider = z.object({
  flavor: z.enum(["openai", "anthropic", "google", "openrouter", "aigateway", "ollama", "openai-compatible"]),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const LlmModelConfig = z.object({
  provider: LlmProvider,
  model: z.string(),
  models: z.array(z.string()).optional(),
  providers: z.record(z.string(), z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    model: z.string().optional(),
    models: z.array(z.string()).optional(),
  })).optional(),
  // Per-category model overrides (BYOK only — signed-in users always get
  // the curated gateway defaults). Read by helpers in core/models/defaults.ts.
  knowledgeGraphModel: z.string().optional(),
  meetingNotesModel: z.string().optional(),
  trackBlockModel: z.string().optional(),
});
