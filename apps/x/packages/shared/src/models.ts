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
  knowledgeGraphModel: z.string().optional(),
});
