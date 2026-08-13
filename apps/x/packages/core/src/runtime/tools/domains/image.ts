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

// Readable failure text for the common OpenRouter image-generation faults;
// always carries the underlying error message so nothing is swallowed.
function describeImageError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (NoImageGeneratedError.isInstance(error)) {
        return `Model returned no image — it may not support image output. (${message})`;
    }
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    if (statusCode === 402 || message.includes("402")) {
        return `OpenRouter account is out of credits (HTTP 402). Add credits at openrouter.ai to generate images. (${message})`;
    }
    if (statusCode === 404 || message.includes("404") || /model.*not.*found/i.test(message)) {
        return `Image model '${DEFAULT_IMAGE_MODEL}' was not found on OpenRouter (HTTP 404). (${message})`;
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
        description: "Generate an image from a text prompt. Use this tool whenever the user asks to generate, create, or draw an image or picture. It renders the prompt with an image model and saves the result as a PNG file, returning the saved file's absolute path. After a successful call, present that path to the user wrapped in a ```filepath code block. The prompt should be a vivid, self-contained description of the desired image.",
        inputSchema: z.object({
            prompt: z.string().describe('A vivid, self-contained description of the image to generate. Include the subject, style, setting, and any important details.'),
            filename: z.string().optional().describe('Short kebab-case basename for the saved file, without extension (e.g. "sunset-over-lake"). Derived from the prompt when omitted.'),
            aspectRatio: z.string().optional().describe('Aspect ratio of the image, e.g. "1:1" or "16:9". Only pass this when the user asks for a specific shape.'),
        }),
        isAvailable: async () => {
            if (await isSignedIn()) return true;
            return (await findOpenRouterProvider()) !== null;
        },
        execute: async ({ prompt, filename, aspectRatio }: { prompt: string; filename?: string; aspectRatio?: string }) => {
            const aspect = aspectRatio ? { aspectRatio: aspectRatio as `${number}:${number}` } : {};

            // Signed-in: the gateway is the primary path; BYOK (when
            // configured) is the fallback, with the gateway failure noted on
            // the result.
            let gatewayNote: string | undefined;
            if (await isSignedIn()) {
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

            try {
                const result = await generateImage({
                    model: openrouter.imageModel(DEFAULT_IMAGE_MODEL),
                    prompt,
                    ...aspect,
                });
                const filePath = await saveGeneratedImage(result, filename, prompt);
                return {
                    success: true,
                    path: filePath,
                    provider: "openrouter",
                    model: DEFAULT_IMAGE_MODEL,
                    ...(gatewayNote ? { note: gatewayNote } : {}),
                };
            } catch (error) {
                return {
                    success: false,
                    error: describeImageError(error),
                };
            }
        },
    },
};
