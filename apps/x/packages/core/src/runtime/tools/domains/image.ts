// Builtin tools: image generation domain. Dual-mode like web-search: a
// signed-in user renders through the Rowboat gateway first, falling back to
// the user's own image-capable provider (OpenRouter, Google, OpenAI, Ollama,
// or an OpenAI-compatible server); BYOK-only users go straight to their
// provider. Available when either path exists.

import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { randomBytes } from "crypto";
import { generateImage, NoImageGeneratedError, type GeneratedFile, type ImageModel, type Warning } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LlmProvider } from "@x/shared/dist/models.js";
import { WorkDir } from "../../../config/config.js";
import { isSignedIn } from "../../../account/account.js";
import { getGatewayProvider } from "../../../models/gateway.js";
import container from "../../../di/container.js";
import type { IModelConfigRepo } from "../../../models/repo.js";
import { BuiltinToolsSchema } from "../types.js";
import type { ToolContext } from "../exec-tool.js";

// The gateway's image model until it publishes an official default. Kept
// separate from the BYOK defaults so they can diverge.
const GATEWAY_IMAGE_MODEL = "google/gemini-2.5-flash-image";

// Per-flavor BYOK defaults, each in its provider's own naming (only
// OpenRouter prefixes the vendor). openai-compatible has NO default — the
// server's catalog is unknowable, so the user must name the model.
const OPENROUTER_IMAGE_MODEL = "google/gemini-2.5-flash-image";
const GOOGLE_IMAGE_MODEL = "gemini-2.5-flash-image";
// Newest id the installed @ai-sdk/openai documents (beyond gpt-image-1).
const OPENAI_IMAGE_MODEL = "gpt-image-2";
// Ollama's launch image model, published under the `x/` namespace; must be
// pulled locally (`ollama pull x/z-image-turbo`).
const OLLAMA_IMAGE_MODEL = "x/z-image-turbo";

type ImageFlavor = "openrouter" | "google" | "openai" | "ollama" | "openai-compatible";

interface ImageBackend {
    flavor: ImageFlavor;
    config: z.infer<typeof LlmProvider>;
    /** null = no safe default for this flavor; the user must name a model. */
    defaultModel: string | null;
    makeImageModel: (modelId: string) => ImageModel;
}

// Ollama serves image generation on its OpenAI-compatible surface at
// <host>/v1 (the chat path uses the native /api instead), so the configured
// baseURL — which may already carry /api — is rebased onto /v1.
function ollamaV1BaseURL(baseURL: string | undefined): string {
    const host = (baseURL ?? "http://localhost:11434")
        .replace(/\/+$/, "")
        .replace(/\/api$/, "");
    return `${host}/v1`;
}

// The per-flavor image entry point. Providers are built directly (not via
// createProvider) — that path casts to ProviderV4 and predates image use;
// building here keeps each flavor's own imageModel typing intact.
function makeBackend(config: z.infer<typeof LlmProvider>): ImageBackend | null {
    const { apiKey, baseURL, headers } = config;
    switch (config.flavor) {
        case "openrouter":
            return {
                flavor: "openrouter",
                config,
                defaultModel: OPENROUTER_IMAGE_MODEL,
                makeImageModel: (id) => createOpenRouter({ apiKey, baseURL, headers }).imageModel(id),
            };
        case "google":
            return {
                flavor: "google",
                config,
                defaultModel: GOOGLE_IMAGE_MODEL,
                makeImageModel: (id) => createGoogleGenerativeAI({ apiKey, baseURL, headers }).imageModel(id),
            };
        case "openai":
            return {
                flavor: "openai",
                config,
                defaultModel: OPENAI_IMAGE_MODEL,
                makeImageModel: (id) => createOpenAI({ apiKey, baseURL, headers }).imageModel(id),
            };
        case "ollama":
            return {
                flavor: "ollama",
                config,
                defaultModel: OLLAMA_IMAGE_MODEL,
                makeImageModel: (id) => createOpenAICompatible({
                    name: "ollama",
                    apiKey,
                    baseURL: ollamaV1BaseURL(baseURL),
                    headers,
                }).imageModel(id),
            };
        case "openai-compatible":
            return {
                flavor: "openai-compatible",
                config,
                defaultModel: null,
                makeImageModel: (id) => createOpenAICompatible({
                    name: "openai-compatible",
                    apiKey,
                    baseURL: baseURL || "",
                    headers,
                }).imageModel(id),
            };
        default:
            return null;
    }
}

// First image-capable provider from models.json, with the assistant model's
// provider tried first (mirrors the models catalog ordering). An unreadable
// config just gates the tool off rather than erroring.
async function resolveImageBackend(): Promise<ImageBackend | null> {
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        const cfg = await repo.getConfig();
        const assistantProvider = cfg.assistantModel?.provider ?? "";
        const ids = Object.keys(cfg.providers)
            .sort((a, b) => (a === assistantProvider ? -1 : b === assistantProvider ? 1 : 0));
        for (const id of ids) {
            const entry = cfg.providers[id];
            if (!entry) continue;
            const backend = makeBackend(entry);
            if (backend) return backend;
        }
        return null;
    } catch {
        return null;
    }
}

// Filesystem-safe basename: lowercase, [a-z0-9-] only, no leading/trailing
// dashes. Empty results fall back at the call site.
function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// Safe-charset check only — each provider validates its own naming server-
// side (only OpenRouter ids carry a vendor/ prefix).
const MODEL_ID_SHAPE = /^[\w.:/-]{1,128}$/;

// Loose on purpose — each provider enforces its own exact ratio enum; this
// only stops malformed strings before they reach the API. "auto" is accepted
// here and dropped at the call site (provider default = no field).
const ASPECT_RATIO_SHAPE = /^(auto|\d+(\.\d+)?:\d+(\.\d+)?)$/;

// Tokens shared by half the image catalog — matching on them would suggest
// everything, so they carry no signal.
const GENERIC_MODEL_TOKENS = new Set(["image", "preview", "pro", "flash", "lite", "turbo", "quality"]);

// The unknown-model shape, shared by the error text and the did-you-mean
// lookup so the two can never disagree about what a 404 is.
function isModelNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    return statusCode === 404 || message.includes("404") || /model.*not.*found/i.test(message);
}

// Best-effort "did you mean" for an unknown OpenRouter image model. The
// catalog endpoint is public (no auth) and filtered to image output. Purely
// decorative: ANY failure — offline, timeout, non-200, unexpected shape —
// returns null and the caller's message stands exactly as it would have.
async function suggestOpenRouterImageModels(requestedId: string): Promise<string[] | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const res = await fetch(
            "https://openrouter.ai/api/v1/models?output_modalities=image",
            { signal: controller.signal },
        );
        if (!res.ok) return null;
        const data = await res.json() as { data?: Array<{ id?: unknown }> };
        const ids = (data.data ?? [])
            .map((entry) => entry?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
        const tokens = requestedId
            .toLowerCase()
            .split(/[/\-._]+/)
            // 1-2 char fragments ("x", "ai") match across vendors and would
            // suggest e.g. an OpenAI model for a Grok request.
            .filter((token) => token.length > 2 && !GENERIC_MODEL_TOKENS.has(token));
        if (tokens.length === 0) return null;
        // Rank by how many of the distinctive tokens an id contains, so the
        // right vendor's model outranks an incidental substring hit.
        return ids
            .map((id) => {
                const lower = id.toLowerCase();
                return { id, score: tokens.filter((token) => lower.includes(token)).length };
            })
            .filter((candidate) => candidate.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((candidate) => candidate.id);
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// Readable failure text for the common image-generation faults, tuned per
// flavor; always carries the underlying error message so nothing is
// swallowed.
function describeImageError(error: unknown, modelId: string, flavor: ImageFlavor): string {
    const message = error instanceof Error ? error.message : String(error);
    if (NoImageGeneratedError.isInstance(error)) {
        return `Model returned no image — it may not support image output. (${message})`;
    }
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    if (flavor === "ollama" && /ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed/i.test(message)) {
        return `Could not reach Ollama. Is Ollama running? (ollama serve) (${message})`;
    }
    if (statusCode === 402 || message.includes("402")) {
        return flavor === "openrouter"
            ? `OpenRouter account is out of credits (HTTP 402). Add credits at openrouter.ai to generate images. (${message})`
            : `Your ${flavor} account reported a billing problem (HTTP 402). (${message})`;
    }
    if (isModelNotFoundError(error)) {
        const pullHint = flavor === "ollama" ? ` Pull it first: ollama pull ${modelId}.` : "";
        return `Image model '${modelId}' was not found on ${flavor} (HTTP 404).${pullHint} (${message})`;
    }
    if (statusCode === 401 || statusCode === 403 || /unauthorized|API_KEY_INVALID|invalid.{0,10}api.?key|incorrect api key/i.test(message)) {
        return `The ${flavor} provider rejected the request as unauthorized — its API key may be invalid or missing. Check the ${flavor} entry in model settings. (${message})`;
    }
    return `Image generation failed: ${message}`;
}

// Gateway failures get their own framing: a 404 / "No endpoints" /
// unknown-model shape most likely means the gateway doesn't route image
// models yet. The raw error text is kept verbatim so the failure can be
// diagnosed from the tool result alone.
function describeGatewayError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    if (
        statusCode === 404
        || message.includes("404")
        || /no endpoints/i.test(message)
        || /model.*not.*found|unknown model/i.test(message)
        || NoImageGeneratedError.isInstance(error)
    ) {
        return `The Rowboat gateway may not expose image generation yet (model '${GATEWAY_IMAGE_MODEL}'). Raw error: ${message}`;
    }
    return `Image generation via the Rowboat gateway failed: ${message}`;
}

// OpenAI's image API takes a fixed `size` rather than an aspect ratio (the
// SDK warns and drops `aspectRatio`). Map the requested shape onto the sizes
// the gpt-image family documents; dall-e models have their own size table
// and are left to the provider warning instead.
function openaiSizeForAspect(modelId: string, aspectRatio: string): `${number}x${number}` | undefined {
    if (modelId.startsWith("dall-e")) return undefined;
    const [w, h] = aspectRatio.split(":").map(Number);
    if (!w || !h) return undefined;
    if (w > h) return "1536x1024";
    if (w < h) return "1024x1536";
    return "1024x1024";
}

// Provider warnings as plain text so the tool result carries them (e.g. a
// model that ignores aspectRatio) instead of silently dropping them.
function formatWarnings(warnings: Warning[]): string[] {
    return warnings.map((w) => {
        switch (w.type) {
            case "unsupported":
                return `Unsupported: ${w.feature}${w.details ? ` — ${w.details}` : ""}`;
            case "compatibility":
                return `Compatibility: ${w.feature}${w.details ? ` — ${w.details}` : ""}`;
            case "deprecated":
                return `Deprecated: ${w.setting} — ${w.message}`;
            default:
                return w.message;
        }
    });
}

// One generation path for every flavor: the AI SDK image interface. (The
// installed @ai-sdk/google accepts Gemini image ids on it directly, so no
// generateText + responseModalities branch is needed.) The turn's abort
// signal rides along so a stopped turn cancels the (billed) request.
async function runImageGeneration(
    backend: Pick<ImageBackend, "flavor" | "makeImageModel">,
    modelId: string,
    prompt: string,
    aspectRatio: `${number}:${number}` | undefined,
    signal: AbortSignal | undefined,
): Promise<{ image: GeneratedFile; warnings: string[] }> {
    const size = backend.flavor === "openai" && aspectRatio
        ? openaiSizeForAspect(modelId, aspectRatio)
        : undefined;
    const result = await generateImage({
        model: backend.makeImageModel(modelId),
        prompt,
        // OpenAI takes size, everyone else takes the ratio; sending both
        // would only add a second warning.
        ...(size ? { size } : aspectRatio ? { aspectRatio } : {}),
        abortSignal: signal,
    });
    const image = result.images[0];
    if (!image) {
        throw new Error("Model returned no image — it may not support image output.");
    }
    return { image, warnings: formatWarnings(result.warnings) };
}

// Extension from the provider-reported media type; PNG when unrecognised.
const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

// Write a generated image to <WorkDir>/generated_images and return its
// absolute path. The timestamp keeps the folder sortable; the random suffix
// keeps parallel calls with the same name from colliding.
async function saveGeneratedImage(
    image: Pick<GeneratedFile, "uint8Array" | "mediaType">,
    filename: string | undefined,
    prompt: string,
): Promise<string> {
    const dir = path.join(WorkDir, "generated_images");
    await fs.mkdir(dir, { recursive: true });
    const safeName = slugify(filename ?? "")
        || slugify(prompt.split(/\s+/).slice(0, 6).join(" "))
        || "image";
    const mediaType = (image.mediaType.split(";")[0] ?? "").trim().toLowerCase();
    const ext = EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "png";
    const suffix = randomBytes(3).toString("hex");
    const filePath = path.join(dir, `${safeName}-${Date.now()}-${suffix}.${ext}`);
    await fs.writeFile(filePath, image.uint8Array);
    return filePath;
}

export const imageTools: z.infer<typeof BuiltinToolsSchema> = {
    'generate-image': {
        permission: "none",
        description: "Generate an image from a text prompt. Use this tool whenever the user asks to generate, create, or draw an image or picture. It renders the prompt with the default image model — unless the user explicitly names one — and saves the result as an image file, returning the saved file's absolute path. After a successful call, present that path to the user wrapped in a ```filepath code block. The prompt should be a vivid, self-contained description of the desired image.",
        inputSchema: z.object({
            prompt: z.string().describe('A vivid, self-contained description of the image to generate. Include the subject, style, setting, and any important details.'),
            filename: z.string().optional().describe('Short kebab-case basename for the saved file, without extension (e.g. "sunset-over-lake"). Derived from the prompt when omitted.'),
            aspectRatio: z.string().optional().describe('Aspect ratio of the image as width:height — common values are "1:1", "16:9", "9:16", "4:3" — or "auto". Only pass this when the user asks for a specific shape.'),
            model: z.string().optional().describe('Image model id in the ACTIVE provider\'s naming: OpenRouter "vendor/model" (e.g. "x-ai/grok-imagine-image-quality", "bytedance-seed/seedream-4.5", "google/gemini-2.5-flash-image"), Google "gemini-…" (e.g. "gemini-2.5-flash-image"), OpenAI "gpt-image-…", Ollama a locally pulled model name. Pass ONLY when the user explicitly names an image model or provider (e.g. "use gpt-image-1", "make it with Grok"); omit otherwise to use the default model.'),
        }),
        isAvailable: async () => {
            if (await isSignedIn()) return true;
            return (await resolveImageBackend()) !== null;
        },
        execute: async (
            { prompt, filename, aspectRatio, model }: { prompt: string; filename?: string; aspectRatio?: string; model?: string },
            ctx?: ToolContext,
        ) => {
            const signal = ctx?.signal;
            const aspectInput = aspectRatio?.trim() || undefined;
            if (aspectInput && !ASPECT_RATIO_SHAPE.test(aspectInput)) {
                return {
                    success: false,
                    error: `Invalid aspectRatio '${aspectInput}'. Expected width:height (e.g. "16:9") or "auto".`,
                };
            }
            // "auto" is the provider default, which every provider expresses
            // by omitting the field (Google rejects a literal "auto").
            const aspect = aspectInput && aspectInput !== "auto"
                ? aspectInput as `${number}:${number}`
                : undefined;

            const modelOverride = model?.trim() || undefined;
            if (modelOverride && !MODEL_ID_SHAPE.test(modelOverride)) {
                return {
                    success: false,
                    error: `Invalid image model id '${modelOverride}'. Use the active provider's naming — OpenRouter "vendor/model" (e.g. "x-ai/grok-imagine-image-quality", "bytedance-seed/seedream-4.5"), Google "gemini-…", OpenAI "gpt-image-…", Ollama a locally pulled model name.`,
                };
            }

            // One config read serves the whole call: the same backend gates
            // model overrides, is the gateway fallback, and runs BYOK.
            const backend = await resolveImageBackend();

            // Signed-in: the gateway is the primary path; the user's own
            // provider (when configured) is the fallback, with the gateway
            // failure noted on the result. The gateway always renders
            // GATEWAY_IMAGE_MODEL — gateway billing is Rowboat's, so per-call
            // model overrides are not offered there — and an explicit model
            // choice skips it and runs on the user's own provider.
            let gatewayNote: string | undefined;
            if (await isSignedIn()) {
                if (modelOverride) {
                    if (!backend) {
                        return {
                            success: false,
                            error: `Choosing a specific image model requires your own provider (OpenRouter, Google, OpenAI, Ollama, or an OpenAI-compatible server). Add one in model settings, or omit the model to use the default (${GATEWAY_IMAGE_MODEL}).`,
                        };
                    }
                } else {
                    try {
                        // The gateway fronts OpenRouter, so it takes the ratio
                        // the same way the openrouter flavor does.
                        const { image, warnings } = await runImageGeneration(
                            { flavor: "openrouter", makeImageModel: (id) => getGatewayProvider().imageModel(id) },
                            GATEWAY_IMAGE_MODEL,
                            prompt,
                            aspect,
                            signal,
                        );
                        const filePath = await saveGeneratedImage(image, filename, prompt);
                        return {
                            success: true,
                            path: filePath,
                            provider: "rowboat",
                            model: GATEWAY_IMAGE_MODEL,
                            ...(warnings.length > 0 ? { warnings } : {}),
                        };
                    } catch (error) {
                        // A stopped turn is not a gateway fault: let it
                        // propagate so the runtime records the cancellation
                        // instead of retrying on the user's own provider.
                        if (signal?.aborted) throw error;
                        // Only a backend that can run without an explicit
                        // model is a usable fallback here (openai-compatible
                        // has no default).
                        if (!backend?.defaultModel) {
                            return {
                                success: false,
                                error: describeGatewayError(error),
                            };
                        }
                        const message = error instanceof Error ? error.message : String(error);
                        gatewayNote = `Rowboat gateway image call failed (${message.slice(0, 120)}); used your ${backend.flavor} provider instead.`;
                    }
                }
            }

            if (!backend) {
                return {
                    success: false,
                    error: "No image-capable model provider configured. Add an OpenRouter, Google, OpenAI, Ollama, or OpenAI-compatible provider in model settings to enable image generation.",
                };
            }

            const byokModel = modelOverride ?? backend.defaultModel;
            if (!byokModel) {
                return {
                    success: false,
                    error: `Your ${backend.flavor} provider has no default image model. Ask again naming the image model your server hosts (e.g. "generate ... with <model-id>").`,
                };
            }

            try {
                const { image, warnings } = await runImageGeneration(backend, byokModel, prompt, aspect, signal);
                const filePath = await saveGeneratedImage(image, filename, prompt);
                return {
                    success: true,
                    path: filePath,
                    provider: backend.flavor,
                    model: byokModel,
                    ...(warnings.length > 0 ? { warnings } : {}),
                    ...(gatewayNote ? { note: gatewayNote } : {}),
                };
            } catch (error) {
                if (signal?.aborted) throw error;
                let errorText = describeImageError(error, byokModel, backend.flavor);
                // An unknown OpenRouter id is usually a near-miss on a real
                // one; the catalog lookup is decorative and never changes the
                // outcome when it fails.
                if (backend.flavor === "openrouter" && isModelNotFoundError(error)) {
                    const suggestions = await suggestOpenRouterImageModels(byokModel);
                    if (suggestions && suggestions.length > 0) {
                        errorText += ` Did you mean: ${suggestions.join(", ")}?`;
                    }
                }
                return {
                    success: false,
                    error: errorText,
                };
            }
        },
    },
};
