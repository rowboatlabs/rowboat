// Builtin tools: voice domain. Exposes the app's own speech stack (the same
// ElevenLabs/Deepgram credentials — or the signed-in Rowboat proxy — that
// power voice mode) as assistant tools, so agents and Rowboat Apps can
// speak and listen without any new API keys.

import { z } from "zod";
import * as files from "../../../filesystem/files.js";
import { BuiltinToolsSchema } from "../types.js";

// voice/voice.js reaches di/container (via auth/tokens), which circles back
// to the catalog through the agent resolver — import it lazily so this
// domain can never trip the cycle regardless of evaluation order (same
// lesson as the skills/index ↔ models/defaults cycle).

export const MAX_TTS_TEXT_CHARS = 5000;
const MAX_TRANSCRIBE_BYTES = 100 * 1024 * 1024;

export const voiceTools: z.infer<typeof BuiltinToolsSchema> = {
    'text-to-speech': {
        permission: "file-boundary",
        description: "Convert text to natural spoken audio (the app's own voice stack — no API keys needed) and save it as an .mp3 file. Returns the saved path. Use for narration, audio versions of notes/summaries, or dialogue segments. Pass different ElevenLabs voiceIds across calls to voice different speakers (e.g. a two-host podcast).",
        inputSchema: z.object({
            text: z.string().min(1).max(MAX_TTS_TEXT_CHARS)
                .describe(`The text to speak (max ${MAX_TTS_TEXT_CHARS} chars — synthesize long content one segment per call)`),
            outputPath: z.string().optional()
                .describe("Where to save the .mp3 (workspace-relative or absolute). Default: media/tts/tts-<timestamp>.mp3"),
            voiceId: z.string().optional()
                .describe("ElevenLabs voice id (e.g. pNInz6obpgDQGcFmaJgB male, 21m00Tcm4TlvDq8ikWAM female). Omit for the app's default voice."),
        }),
        execute: async ({ text, outputPath, voiceId }: { text: string; outputPath?: string; voiceId?: string }) => {
            try {
                const { synthesizeSpeech } = await import("../../../voice/voice.js");
                // Produced artifact → quality tier (voice mode keeps flash).
                const { audioBase64, mimeType } = await synthesizeSpeech(text, { voiceId, modelId: 'eleven_turbo_v2_5' });
                const buffer = Buffer.from(audioBase64, 'base64');
                const target = outputPath
                    || `media/tts/tts-${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`;
                const result = await files.writeBuffer(target, buffer);
                return { success: true, path: result.path, resolvedPath: result.resolvedPath, mimeType, bytes: buffer.length };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    'transcribe-audio': {
        permission: "file-boundary",
        description: "Transcribe an audio file to text using the app's speech-to-text (same credentials as voice mode — no API keys needed). Handles common formats (wav, mp3, ogg/opus, webm). Use for voice memos, recordings, or audio produced by text-to-speech.",
        inputSchema: z.object({
            path: z.string().describe("The audio file to transcribe (workspace-relative or absolute)"),
        }),
        execute: async ({ path: inputPath }: { path: string }) => {
            try {
                const { buffer, path: originalPath } = await files.readBuffer(inputPath);
                if (buffer.length === 0) return { success: false, error: `File is empty: ${inputPath}` };
                if (buffer.length > MAX_TRANSCRIBE_BYTES) {
                    return { success: false, error: `File exceeds ${MAX_TRANSCRIBE_BYTES / (1024 * 1024)} MB: ${inputPath}` };
                }
                const { transcribeAudio } = await import("../../../voice/voice.js");
                const { transcript } = await transcribeAudio(buffer);
                return { success: true, path: originalPath, transcript };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};
