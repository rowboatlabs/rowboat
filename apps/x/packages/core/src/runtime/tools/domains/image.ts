// Builtin tools: image generation domain. Renders with the image model the
// user picked in model settings (models.json `imageModel`, seeded with the
// Rowboat gateway's default on sign-in) — the same durable
// { provider, model } selection text models use. Nothing is resolved at
// runtime and nothing falls back: the configured provider's error is the
// tool's error. Unavailable until an image model is configured.

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

// BYOK flavors that can build an AI SDK image model. "rowboat" (the
// signed-in gateway) is the credential-less sixth path; anthropic /
// aigateway / codex have no image surface here.
type ImageFlavor = "openrouter" | "google" | "openai" | "ollama" | "openai-compatible" | "rowboat";

interface ImageBackend {
    flavor: ImageFlavor;
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

// The per-flavor image entry point for a BYOK provider entry. Providers are
// built directly (not via createProvider) — that path casts to ProviderV4
// and predates image use; building here keeps each flavor's own imageModel
// typing intact. null = the flavor has no image surface.
function makeBackend(config: z.infer<typeof LlmProvider>): ImageBackend | null {
    const { apiKey, baseURL, headers } = config;
    switch (config.flavor) {
        case "openrouter":
            return {
                flavor: "openrouter",
                makeImageModel: (id) => createOpenRouter({ apiKey, baseURL, headers }).imageModel(id),
            };
        case "google":
            return {
                flavor: "google",
                makeImageModel: (id) => createGoogleGenerativeAI({ apiKey, baseURL, headers }).imageModel(id),
            };
        case "openai":
            return {
                flavor: "openai",
                makeImageModel: (id) => createOpenAI({ apiKey, baseURL, headers }).imageModel(id),
            };
        case "ollama":
            return {
                flavor: "ollama",
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

const NO_IMAGE_MODEL_ERROR = "No image model configured. Pick one under model settings → Image model: signed-in users can use the Rowboat gateway; otherwise choose an OpenRouter, Google, OpenAI, Ollama, or OpenAI-compatible provider and one of its image models.";

type ImageResolution =
    | { ok: true; backend: ImageBackend; model: string }
    | { ok: false; error: string };

// The configured image model, resolved to a backend — the ONE decision path
// for both availability and execution so the two can never disagree.
// "rowboat" is the gateway (needs sign-in); any other provider id is an
// entry in models.json's providers map. No provider walk, no defaults.
async function resolveImageBackend(): Promise<ImageResolution> {
    let cfg;
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        cfg = await repo.getConfig();
    } catch {
        // Fresh install before ensureConfig ran, or an unreadable file.
        return { ok: false, error: NO_IMAGE_MODEL_ERROR };
    }
    const selection = cfg.imageModel;
    if (!selection) return { ok: false, error: NO_IMAGE_MODEL_ERROR };
    if (selection.provider === "rowboat") {
        if (!(await isSignedIn())) {
            return {
                ok: false,
                error: "The configured image model runs on the Rowboat gateway, but you are signed out. Sign in, or pick another image model in model settings.",
            };
        }
        return {
            ok: true,
            backend: { flavor: "rowboat", makeImageModel: (id) => getGatewayProvider().imageModel(id) },
            model: selection.model,
        };
    }
    const entry = cfg.providers[selection.provider];
    if (!entry) {
        return {
            ok: false,
            error: `The configured image model references provider '${selection.provider}', which is not set up. Reconnect it or pick another image model in model settings.`,
        };
    }
    const backend = makeBackend(entry);
    if (!backend) {
        return {
            ok: false,
            error: `The configured image model's provider '${selection.provider}' (${entry.flavor}) does not support image generation. Pick an OpenRouter, Google, OpenAI, Ollama, or OpenAI-compatible provider in model settings.`,
        };
    }
    return { ok: true, backend, model: selection.model };
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
// lookup so the two can never disagree about what a 404 is. "No endpoints"
// is OpenRouter's (and so the gateway's) wording for an id it can't route.
function isModelNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    return statusCode === 404
        || message.includes("404")
        || /no endpoints/i.test(message)
        || /model.*not.*found|unknown model/i.test(message);
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
// swallowed. The gateway gets its own framing where the fix differs: its
// auth is the sign-in (no key to check) and its catalog is an allowlist.
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
        if (flavor === "rowboat") {
            return `Your Rowboat account reported a billing problem (HTTP 402) — check your plan and credits. (${message})`;
        }
        return flavor === "openrouter"
            ? `OpenRouter account is out of credits (HTTP 402). Add credits at openrouter.ai to generate images. (${message})`
            : `Your ${flavor} account reported a billing problem (HTTP 402). (${message})`;
    }
    if (isModelNotFoundError(error)) {
        if (flavor === "rowboat") {
            return `Image model '${modelId}' was not found on the Rowboat gateway — it may not be on the gateway's image allowlist (GET /v1/llm/models?output_modalities=image lists it). Pick a listed model in model settings. (${message})`;
        }
        const pullHint = flavor === "ollama" ? ` Pull it first: ollama pull ${modelId}.` : "";
        return `Image model '${modelId}' was not found on ${flavor} (HTTP 404).${pullHint} (${message})`;
    }
    if (statusCode === 401 || statusCode === 403 || /unauthorized|API_KEY_INVALID|invalid.{0,10}api.?key|incorrect api key/i.test(message)) {
        if (flavor === "rowboat") {
            return `The Rowboat gateway rejected the request as unauthorized — your sign-in may have expired. Sign in again. (${message})`;
        }
        return `The ${flavor} provider rejected the request as unauthorized — its API key may be invalid or missing. Check the ${flavor} entry in model settings. (${message})`;
    }
    return `Image generation failed: ${message}`;
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
    backend: ImageBackend,
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
        // OpenAI takes size, everyone else (the gateway fronts OpenRouter)
        // takes the ratio; sending both would only add a second warning.
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
        description: "Generate an image from a text prompt. Use this tool whenever the user asks to generate, create, or draw an image or picture. It renders the prompt with the image model configured in model settings — unless the user explicitly names one — and saves the result as an image file, returning the saved file's absolute path. After a successful call, present that path to the user wrapped in a ```filepath code block. The prompt should be a vivid, self-contained description of the desired image.",
        inputSchema: z.object({
            prompt: z.string().describe('A vivid, self-contained description of the image to generate. Include the subject, style, setting, and any important details.'),
            filename: z.string().optional().describe('Short kebab-case basename for the saved file, without extension (e.g. "sunset-over-lake"). Derived from the prompt when omitted.'),
            aspectRatio: z.string().optional().describe('Aspect ratio of the image as width:height — common values are "1:1", "16:9", "9:16", "4:3" — or "auto". Only pass this when the user asks for a specific shape.'),
            model: z.string().optional().describe('Image model id to use INSTEAD of the configured one, on the SAME configured provider (the provider cannot be changed per call). Use that provider\'s naming: Rowboat gateway / OpenRouter "vendor/model" (e.g. "google/gemini-2.5-flash-image", "x-ai/grok-imagine-image-quality", "bytedance-seed/seedream-4.5"), Google "gemini-…" (e.g. "gemini-2.5-flash-image"), OpenAI "gpt-image-…", Ollama a locally pulled model name. Pass ONLY when the user explicitly names an image model (e.g. "use gpt-image-1", "make it with Grok"); omit otherwise to use the configured model.'),
        }),
        isAvailable: async () => (await resolveImageBackend()).ok,
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
                    error: `Invalid image model id '${modelOverride}'. Use the configured provider's naming — Rowboat gateway / OpenRouter "vendor/model" (e.g. "google/gemini-2.5-flash-image", "x-ai/grok-imagine-image-quality"), Google "gemini-…", OpenAI "gpt-image-…", Ollama a locally pulled model name.`,
                };
            }

            const resolved = await resolveImageBackend();
            if (!resolved.ok) {
                return { success: false, error: resolved.error };
            }
            const { backend } = resolved;
            // An explicit model swaps only the id; the provider stays the
            // configured one (the gateway's allowlist is enforced server-
            // side, so an unlisted id there fails like any unknown model).
            const modelId = modelOverride ?? resolved.model;

            try {
                const { image, warnings } = await runImageGeneration(backend, modelId, prompt, aspect, signal);
                const filePath = await saveGeneratedImage(image, filename, prompt);
                return {
                    success: true,
                    path: filePath,
                    provider: backend.flavor,
                    model: modelId,
                    ...(warnings.length > 0 ? { warnings } : {}),
                };
            } catch (error) {
                // A stopped turn is not a provider fault: let it propagate so
                // the runtime records the cancellation.
                if (signal?.aborted) throw error;
                let errorText = describeImageError(error, modelId, backend.flavor);
                // An unknown OpenRouter id is usually a near-miss on a real
                // one; the catalog lookup is decorative and never changes the
                // outcome when it fails. (Not for the gateway: its allowlist,
                // not OpenRouter's catalog, decides what it serves.)
                if (backend.flavor === "openrouter" && isModelNotFoundError(error)) {
                    const suggestions = await suggestOpenRouterImageModels(modelId);
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
