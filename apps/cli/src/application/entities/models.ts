import z from "zod";

export const Provider = z.object({
    flavor: z.enum(["openai", "anthropic", "google", "ollama"]),
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