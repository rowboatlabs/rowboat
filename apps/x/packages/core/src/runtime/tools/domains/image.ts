// Builtin tools: image generation domain. Dual-mode like web-search: a
// signed-in user renders through the Rowboat gateway first, falling back to
// a configured BYOK OpenRouter provider; BYOK-only users go straight to
// their own key. Available when either path exists.

import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { generateImage, NoImageGeneratedError, type GenerateImageResult } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LlmProvider } from "@x/shared/dist/models.js";
import { WorkDir } from "../../../config/config.js";
import { isSignedIn } from "../../../account/account.js";
import { getGatewayProvider } from "../../../models/gateway.js";
import container from "../../../di/container.js";
import type { IModelConfigRepo } from "../../../models/repo.js";
import { BuiltinToolsSchema } from "../types.js";

const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

// Placeholder until the founders fix the gateway's official default image
// model. Kept separate from the BYOK default so the two can diverge.
const GATEWAY_IMAGE_MODEL = "google/gemini-2.5-flash-image";

// First configured OpenRouter provider entry, or null when none exists (an
// unreadable models.json just gates the tool off rather than erroring).
async function findOpenRouterProvider(): Promise<z.infer<typeof LlmProvider> | null> {
    try {
        const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
        const config = await repo.getConfig();
        return Object.values(config.providers).find((p) => p.flavor === "openrouter") ?? null;
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

// vendor/model, the only id shape OpenRouter accepts.
const MODEL_ID_SHAPE = /^[\w.-]+\/[\w.:-]+$/;

// Readable failure text for the common OpenRouter image-generation faults;
// always carries the underlying error message so nothing is swallowed.
function describeImageError(error: unknown, modelId: string): string {
    const message = error instanceof Error ? error.message : String(error);
    if (NoImageGeneratedError.isInstance(error)) {
        return `Model returned no image — it may not support image output. (${message})`;
    }
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    if (statusCode === 402 || message.includes("402")) {
        return `OpenRouter account is out of credits (HTTP 402). Add credits at openrouter.ai to generate images. (${message})`;
    }
    if (statusCode === 404 || message.includes("404") || /model.*not.*found/i.test(message)) {
        return `Image model '${modelId}' was not found on OpenRouter (HTTP 404). (${message})`;
    }
    return `Image generation failed: ${message}`;
}

// Gateway failures get their own framing: a 404 / "No endpoints" /
// unknown-model shape most likely means the gateway doesn't route image
// models yet. The raw error text is kept verbatim — it is the evidence for
// the founders.
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

// Write the first generated image to <WorkDir>/generated_images and return
// its absolute path.
async function saveGeneratedImage(
    result: GenerateImageResult,
    filename: string | undefined,
    prompt: string,
): Promise<string> {
    const image = result.images[0];
    if (!image) {
        throw new Error("Model returned no image — it may not support image output.");
    }
    const dir = path.join(WorkDir, "generated_images");
    await fs.mkdir(dir, { recursive: true });
    const safeName = slugify(filename ?? "")
        || slugify(prompt.split(/\s+/).slice(0, 6).join(" "))
        || "image";
    const filePath = path.join(dir, `${safeName}-${Date.now()}.png`);
    await fs.writeFile(filePath, Buffer.from(image.base64, "base64"));
    return filePath;
}

export const imageTools: z.infer<typeof BuiltinToolsSchema> = {
    'generate-image': {
        permission: "none",
        description: "Generate an image from a text prompt. Use this tool whenever the user asks to generate, create, or draw an image or picture. It renders the prompt with the default image model — unless the user explicitly names one — and saves the result as a PNG file, returning the saved file's absolute path. After a successful call, present that path to the user wrapped in a ```filepath code block. The prompt should be a vivid, self-contained description of the desired image.",
        inputSchema: z.object({
            prompt: z.string().describe('A vivid, self-contained description of the image to generate. Include the subject, style, setting, and any important details.'),
            filename: z.string().optional().describe('Short kebab-case basename for the saved file, without extension (e.g. "sunset-over-lake"). Derived from the prompt when omitted.'),
            aspectRatio: z.string().optional().describe('Aspect ratio of the image, e.g. "1:1" or "16:9". Only pass this when the user asks for a specific shape.'),
            model: z.string().optional().describe('OpenRouter image-model id like "x-ai/grok-imagine" or "black-forest-labs/flux.2-pro". Pass ONLY when the user explicitly names an image model or provider (e.g. "use gpt-5-image", "grok se banao", "FLUX"); omit otherwise to use the default model.'),
        }),
        isAvailable: async () => {
            if (await isSignedIn()) return true;
            return (await findOpenRouterProvider()) !== null;
        },
        execute: async ({ prompt, filename, aspectRatio, model }: { prompt: string; filename?: string; aspectRatio?: string; model?: string }) => {
            const aspect = aspectRatio ? { aspectRatio: aspectRatio as `${number}:${number}` } : {};

            const modelOverride = model?.trim() || undefined;
            if (modelOverride && !MODEL_ID_SHAPE.test(modelOverride)) {
                return {
                    success: false,
                    error: `Invalid image model id '${modelOverride}'. Expected an OpenRouter id in vendor/model form, e.g. "x-ai/grok-imagine" or "black-forest-labs/flux.2-pro".`,
                };
            }

            // Signed-in: the gateway is the primary path; BYOK (when
            // configured) is the fallback, with the gateway failure noted on
            // the result. The gateway always renders GATEWAY_IMAGE_MODEL —
            // gateway billing is Rowboat's; per-call overrides there are a
            // founder decision — so an explicit model choice skips it and
            // runs on the user's own OpenRouter key.
            let gatewayNote: string | undefined;
            if (await isSignedIn()) {
                if (modelOverride) {
                    if (!(await findOpenRouterProvider())) {
                        return {
                            success: false,
                            error: `Choosing a specific image model currently requires your own OpenRouter key. Add an OpenRouter provider in model settings, or omit the model to use the default (${GATEWAY_IMAGE_MODEL}).`,
                        };
                    }
                } else {
                    try {
                        const result = await generateImage({
                            model: getGatewayProvider().imageModel(GATEWAY_IMAGE_MODEL),
                            prompt,
                            ...aspect,
                        });
                        const filePath = await saveGeneratedImage(result, filename, prompt);
                        return {
                            success: true,
                            path: filePath,
                            provider: "rowboat",
                            model: GATEWAY_IMAGE_MODEL,
                        };
                    } catch (error) {
                        if (!(await findOpenRouterProvider())) {
                            return {
                                success: false,
                                error: describeGatewayError(error),
                            };
                        }
                        const message = error instanceof Error ? error.message : String(error);
                        gatewayNote = `Rowboat gateway image call failed (${message.slice(0, 120)}); used your OpenRouter key instead.`;
                    }
                }
            }

            const provider = await findOpenRouterProvider();
            if (!provider) {
                return {
                    success: false,
                    error: "No OpenRouter provider configured. Add one in model settings to enable image generation.",
                };
            }

            // Built directly (not via createProvider): that path casts to
            // ProviderV4, which loses OpenRouter's imageModel method.
            const openrouter = createOpenRouter({
                apiKey: provider.apiKey,
                baseURL: provider.baseURL,
                headers: provider.headers,
            });

            const byokModel = modelOverride ?? DEFAULT_IMAGE_MODEL;
            try {
                const result = await generateImage({
                    model: openrouter.imageModel(byokModel),
                    prompt,
                    ...aspect,
                });
                const filePath = await saveGeneratedImage(result, filename, prompt);
                return {
                    success: true,
                    path: filePath,
                    provider: "openrouter",
                    model: byokModel,
                    ...(gatewayNote ? { note: gatewayNote } : {}),
                };
            } catch (error) {
                return {
                    success: false,
                    error: describeImageError(error, byokModel),
                };
            }
        },
    },
};
