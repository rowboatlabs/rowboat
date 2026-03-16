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
  knowledgeGraphModel: z.string().optional(),
});

export const ConfiguredModelEntry = z.object({
  flavor: LlmProvider.shape.flavor,
  model: z.string(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  knowledgeGraphModel: z.string().optional(),
});

export const ConfiguredModelsResult = z.object({
  models: z.array(ConfiguredModelEntry),
  activeModelKey: z.string(),
});
