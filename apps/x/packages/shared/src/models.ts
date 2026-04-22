import { z } from "zod";

export const LlmProvider = z.object({
  flavor: z.enum(["openai", "anthropic", "google", "openrouter", "aigateway", "ollama", "openai-compatible", "rowboat"]),
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
  // Deprecated: per-run model+provider supersedes these. Kept on the schema so
  // existing settings/onboarding UIs continue to compile until they're cleaned up.
  knowledgeGraphModel: z.string().optional(),
  meetingNotesModel: z.string().optional(),
});
