// Image generation as a standalone capability — the TTS/ASR pattern
// (voice/voice.ts), NOT another LLM. Image models never enter the model
// registry, the model picker, or models.json:
//
// - Signed in: a dedicated proxy endpoint (`/v1/images/generations`, bearer
//   auth), where the backend owns the model choice — mirroring
//   `/v1/voice/text-to-speech/<voiceId>`.
// - BYOK: `~/.rowboat/config/image-generation.json` with the vendor, its own
//   API key, and the model to use — mirroring elevenlabs.json/exa-search.json.
//
// An explicit BYOK config wins over the signed-in proxy (it's a deliberate
// user choice, like defaultSelection for chat models); unset + signed-in
// falls through to the proxy's curated model.

import { generateImage, generateText, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as fs from "fs/promises";
import * as path from "path";
import { isSignedIn } from "../account/account.js";
import { getAccessToken } from "../auth/tokens.js";
import { getCurrentUseCase } from "../analytics/use_case.js";
import { WorkDir } from "../config/config.js";
import { API_URL } from "../config/env.js";

export const GENERATED_IMAGES_DIR = "generated-images";

const CONFIG_FILENAME = "image-generation.json";
const IMAGE_GEN_PROVIDERS = ["gemini", "openrouter", "openai"] as const;
export type ImageGenProvider = (typeof IMAGE_GEN_PROVIDERS)[number];

export interface ImageGenConfig {
    provider: ImageGenProvider;
    apiKey: string;
    model: string;
}

function configPath(): string {
    return path.join(WorkDir, "config", CONFIG_FILENAME);
}

/** The BYOK image-generation config, or null when absent/incomplete. */
export async function getImageGenConfig(): Promise<ImageGenConfig | null> {
    try {
        const raw = await fs.readFile(configPath(), "utf8");
        const parsed = JSON.parse(raw) as Partial<ImageGenConfig>;
        if (
            typeof parsed.apiKey === "string" && parsed.apiKey &&
            typeof parsed.model === "string" && parsed.model &&
            IMAGE_GEN_PROVIDERS.includes(parsed.provider as ImageGenProvider)
        ) {
            return { provider: parsed.provider as ImageGenProvider, apiKey: parsed.apiKey, model: parsed.model };
        }
        return null;
    } catch {
        return null;
    }
}

/** Availability gate for the generate-image tool and its skill. */
export async function isImageGenerationAvailable(): Promise<boolean> {
    if (await getImageGenConfig()) return true;
    return isSignedIn();
}

export interface GenerateImageArgs {
    prompt: string;
    /** Source images (already read + permission-checked) for edit/remix prompts. */
    sourceImages?: Array<{ bytes: Uint8Array; mediaType: string }>;
    abortSignal?: AbortSignal;
}

export interface GenerateImageOutcome {
    /** Workspace-relative path of the saved image. */
    relPath: string;
    /** Absolute path of the saved image. */
    absPath: string;
    mediaType: string;
    /** "rowboat" for the signed-in proxy, otherwise the BYOK vendor. */
    provider: string;
    /** Model id when known (BYOK config, or reported by the proxy). */
    model?: string;
    /** Any text the model returned alongside the image. */
    text?: string;
    /** Token usage when the vendor reports it (chat-modality paths). */
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

function fileNameForPrompt(prompt: string, mediaType: string): string {
    const slug = prompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "image";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = EXT_BY_MEDIA_TYPE[mediaType] ?? "png";
    return `${slug}-${stamp}.${ext}`;
}

async function saveImage(bytes: Uint8Array, mediaType: string, prompt: string): Promise<{ relPath: string; absPath: string }> {
    const dir = path.join(WorkDir, GENERATED_IMAGES_DIR);
    await fs.mkdir(dir, { recursive: true });
    const fileName = fileNameForPrompt(prompt, mediaType);
    const absPath = path.join(dir, fileName);
    await fs.writeFile(absPath, bytes);
    return { relPath: `${GENERATED_IMAGES_DIR}/${fileName}`, absPath };
}

type RawGeneration = {
    bytes: Uint8Array;
    mediaType: string;
    provider: string;
    model?: string;
    text?: string;
    usage?: GenerateImageOutcome["usage"];
};

// ---- Signed-in proxy path ----

interface ProxyResponse {
    image?: { mediaType?: string; dataBase64?: string };
    model?: string;
}

async function generateViaProxy(args: GenerateImageArgs): Promise<RawGeneration> {
    const accessToken = await getAccessToken();
    // Same attribution headers the LLM gateway sends (gateway.ts authedFetch):
    // the backend stamps them onto its billing/generation records.
    const ctx = getCurrentUseCase();
    const response = await fetch(`${API_URL}/v1/images/generations`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(ctx?.useCase ? { "x-rowboat-use-case": ctx.useCase } : {}),
            ...(ctx?.subUseCase ? { "x-rowboat-sub-use-case": ctx.subUseCase } : {}),
            ...(ctx?.agentName ? { "x-rowboat-agent-name": ctx.agentName } : {}),
        },
        body: JSON.stringify({
            prompt: args.prompt,
            ...(args.sourceImages?.length
                ? {
                    sourceImages: args.sourceImages.map((img) => ({
                        mediaType: img.mediaType,
                        dataBase64: Buffer.from(img.bytes).toString("base64"),
                    })),
                }
                : {}),
        }),
        signal: args.abortSignal ?? null,
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`Image generation API error ${response.status}: ${errText.slice(0, 300)}`);
    }
    const body = await response.json() as ProxyResponse;
    if (!body.image?.dataBase64) {
        throw new Error("Image generation API returned no image");
    }
    return {
        bytes: new Uint8Array(Buffer.from(body.image.dataBase64, "base64")),
        mediaType: body.image.mediaType || "image/png",
        provider: "rowboat",
        ...(body.model ? { model: body.model } : {}),
    };
}

// ---- BYOK vendor paths ----

// Gemini image models (Nano Banana) and OpenRouter-routed image models are
// chat models that return images as file parts from an ordinary completion.
async function generateViaChatModalities(config: ImageGenConfig, args: GenerateImageArgs): Promise<RawGeneration> {
    const model = config.provider === "gemini"
        ? createGoogleGenerativeAI({ apiKey: config.apiKey }).languageModel(config.model)
        : createOpenRouter({ apiKey: config.apiKey }).languageModel(config.model);
    const providerOptions: Record<string, Record<string, string[]>> = config.provider === "gemini"
        ? { google: { responseModalities: ["TEXT", "IMAGE"] } }
        // Spread verbatim into the /chat/completions body by the OpenRouter provider.
        : { openrouter: { modalities: ["image", "text"] } };
    const messages: ModelMessage[] = [{
        role: "user",
        content: [
            { type: "text", text: args.prompt },
            ...(args.sourceImages ?? []).map((img) => ({
                type: "image" as const,
                image: img.bytes,
                mediaType: img.mediaType,
            })),
        ],
    }];
    const result = await generateText({
        model,
        messages,
        providerOptions,
        abortSignal: args.abortSignal,
    });
    const image = result.files.find((f) => f.mediaType.startsWith("image/"));
    if (!image) {
        const detail = result.text?.trim();
        throw new Error(
            `Model ${config.model} returned no image${detail ? ` (model said: ${detail.slice(0, 300)})` : ""}. ` +
            `Make sure the "model" in ${CONFIG_FILENAME} is an image-generation model.`,
        );
    }
    return {
        bytes: image.uint8Array,
        mediaType: image.mediaType,
        provider: config.provider,
        model: config.model,
        text: result.text?.trim() || undefined,
        usage: result.usage,
    };
}

async function generateViaOpenAI(config: ImageGenConfig, args: GenerateImageArgs): Promise<RawGeneration> {
    if (args.sourceImages?.length) {
        throw new Error(
            "The 'openai' image provider does not accept source images here. " +
            "Use the 'gemini' or 'openrouter' provider for image editing.",
        );
    }
    const { image } = await generateImage({
        model: createOpenAI({ apiKey: config.apiKey }).imageModel(config.model),
        prompt: args.prompt,
        abortSignal: args.abortSignal,
    });
    return {
        bytes: image.uint8Array,
        mediaType: image.mediaType,
        provider: config.provider,
        model: config.model,
    };
}

/**
 * Generate one image and save it under `<workspace>/generated-images/`.
 * Throws when image generation is unavailable (signed out and no BYOK
 * config) or the vendor returns no image.
 */
export async function generateImageToWorkspace(args: GenerateImageArgs): Promise<GenerateImageOutcome> {
    const config = await getImageGenConfig();
    let generated: RawGeneration;
    if (config) {
        generated = config.provider === "openai"
            ? await generateViaOpenAI(config, args)
            : await generateViaChatModalities(config, args);
    } else if (await isSignedIn()) {
        generated = await generateViaProxy(args);
    } else {
        throw new Error(
            `Image generation not configured. Create ${configPath()} with ` +
            `{ "provider": "gemini" | "openrouter" | "openai", "apiKey": "<your-key>", "model": "<image model id>" } ` +
            `or sign in to Rowboat.`,
        );
    }

    const { relPath, absPath } = await saveImage(generated.bytes, generated.mediaType, args.prompt);
    return {
        relPath,
        absPath,
        mediaType: generated.mediaType,
        provider: generated.provider,
        ...(generated.model ? { model: generated.model } : {}),
        ...(generated.text ? { text: generated.text } : {}),
        ...(generated.usage ? { usage: generated.usage } : {}),
    };
}
