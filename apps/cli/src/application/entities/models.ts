import z from "zod";

export const Flavor = z.enum([
    "rowboat [free]",
    "anthropic",
    "google",
    "ollama",
    "openai",
    "openai-compatible",
    "openrouter",
]);

export const Provider = z.object({
    flavor: Flavor,
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
});

export const ModelConfig = z.object({
    providers: z.record(z.string(), Provider),
    defaults: z.object({
        provider: z.string(),
        model: z.string(),
    }),
});