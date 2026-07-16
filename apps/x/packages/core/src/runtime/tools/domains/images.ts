// Builtin tools: image-generation domain.

import { z } from "zod";
import * as files from "../../../filesystem/files.js";
import { isImageGenerationAvailable, generateImageToWorkspace } from "../../../images/images.js";
import { captureLlmUsage } from "../../../analytics/usage.js";
import { getCurrentUseCase, withUseCase } from "../../../analytics/use_case.js";
import { BuiltinToolsSchema } from "../types.js";
import type { ToolContext } from "../exec-tool.js";

const SOURCE_IMAGE_MIME_BY_EXT: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
};

export const imageTools: z.infer<typeof BuiltinToolsSchema> = {
    'generate-image': {
        // file-boundary: reading sourceImagePaths outside the workspace
        // requires the same grant as file-readText (see permission-metadata).
        permission: "file-boundary",
        description: 'Generate an image from a text prompt with the configured image model, or edit/remix existing images by passing them as sourceImagePaths. The image is saved under generated-images/ in the workspace and returned as a path. In chat the result is shown to the user automatically — do NOT re-embed it in your reply. In notes or HTML artifacts, reference the returned path (relative to the workspace root).',
        inputSchema: z.object({
            prompt: z.string().min(1).describe('What to generate. Be specific about subject, style, composition, and lighting; for edits, describe the change to make to the source images.'),
            sourceImagePaths: z.array(z.string()).optional().describe('Optional existing images (png/jpg/webp/gif) to edit or remix. Absolute, ~/..., or workspace-relative paths.'),
        }),
        isAvailable: isImageGenerationAvailable,
        execute: async (
            { prompt, sourceImagePaths }: { prompt: string; sourceImagePaths?: string[] },
            toolCtx?: ToolContext,
        ) => {
            try {
                const sourceImages: Array<{ bytes: Uint8Array; mediaType: string }> = [];
                for (const sourcePath of sourceImagePaths ?? []) {
                    const ext = sourcePath.slice(sourcePath.lastIndexOf('.')).toLowerCase();
                    const mediaType = SOURCE_IMAGE_MIME_BY_EXT[ext];
                    if (!mediaType) {
                        return {
                            success: false,
                            error: `Unsupported source image format '${ext || sourcePath}'. Supported: ${Object.keys(SOURCE_IMAGE_MIME_BY_EXT).join(', ')}`,
                        };
                    }
                    const { buffer } = await files.readBuffer(sourcePath);
                    sourceImages.push({ bytes: new Uint8Array(buffer), mediaType });
                }

                const ctx = getCurrentUseCase();
                const result = await withUseCase({
                    useCase: ctx?.useCase ?? 'copilot_chat',
                    subUseCase: 'image_generation',
                    ...(ctx?.agentName ? { agentName: ctx.agentName } : {}),
                }, () => generateImageToWorkspace({
                    prompt,
                    ...(sourceImages.length > 0 ? { sourceImages } : {}),
                    abortSignal: toolCtx?.signal,
                }));

                if (result.usage) {
                    captureLlmUsage({
                        useCase: ctx?.useCase ?? 'copilot_chat',
                        subUseCase: 'image_generation',
                        ...(ctx?.agentName ? { agentName: ctx.agentName } : {}),
                        model: result.model ?? 'unknown',
                        provider: result.provider,
                        usage: result.usage,
                    });
                }

                return {
                    success: true,
                    path: result.relPath,
                    absolutePath: result.absPath,
                    mediaType: result.mediaType,
                    provider: result.provider,
                    ...(result.model ? { model: result.model } : {}),
                    ...(result.text ? { modelNote: result.text } : {}),
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },
};
