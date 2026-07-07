import * as fs from 'fs/promises';
import * as path from 'path';
import { isSignedIn } from '../account/account.js';
import { getAccessToken } from '../auth/tokens.js';
import { WorkDir } from '../config/config.js';
import { API_URL } from '../config/env.js';

export interface VoiceConfig {
    deepgram: { apiKey: string } | null;
    elevenlabs: { apiKey: string; voiceId?: string } | null;
}

async function readJsonConfig(filename: string): Promise<Record<string, unknown> | null> {
    try {
        const configPath = path.join(WorkDir, 'config', filename);
        const raw = await fs.readFile(configPath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function getVoiceConfig(): Promise<VoiceConfig> {
    const dgConfig = await readJsonConfig('deepgram.json');
    const elConfig = await readJsonConfig('elevenlabs.json');

    return {
        deepgram: dgConfig?.apiKey ? { apiKey: dgConfig.apiKey as string } : null,
        elevenlabs: elConfig?.apiKey
            ? { apiKey: elConfig.apiKey as string, voiceId: elConfig.voiceId as string | undefined }
            : null,
    };
}

async function resolveTtsEndpoint(streaming: boolean): Promise<{ url: string; headers: Record<string, string> }> {
    const config = await getVoiceConfig();
    const signedIn = await isSignedIn();

    if (signedIn) {
        const voiceId = config.elevenlabs?.voiceId || 's3TPKV1kjDlVtZbl4Ksh';
        const accessToken = await getAccessToken();
        // The proxy has no dedicated /stream route — the same endpoint is
        // used and the body is consumed progressively; if the proxy buffers,
        // streaming degrades to today's full-body latency, never worse.
        return {
            url: `${API_URL}/v1/voice/text-to-speech/${voiceId}`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        };
    }

    if (!config.elevenlabs) {
        throw new Error(`ElevenLabs not configured. Create ${path.join(WorkDir, 'config', 'elevenlabs.json')} with { "apiKey": "<your-key>" }`);
    }
    const voiceId = config.elevenlabs.voiceId || 's3TPKV1kjDlVtZbl4Ksh';
    return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}${streaming ? '/stream' : ''}`,
        headers: {
            'xi-api-key': config.elevenlabs.apiKey,
            'Content-Type': 'application/json',
        },
    };
}

function ttsRequestBody(text: string): string {
    return JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
        },
    });
}

export async function synthesizeSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    const { url, headers } = await resolveTtsEndpoint(false);
    console.log('[voice] synthesizing speech, text length:', text.length);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: ttsRequestBody(text),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        console.error('[voice] TTS API error:', response.status, errText);
        throw new Error(`TTS API error ${response.status}: ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
    console.log('[voice] synthesized audio, base64 length:', audioBase64.length);
    return { audioBase64, mimeType: 'audio/mpeg' };
}

/**
 * Streaming synthesis: invokes `onChunk` with MP3 bytes as they arrive so
 * playback can start on the first chunk. Resolves when the stream ends;
 * rejects on HTTP/stream errors. Abort via the provided signal.
 */
export async function synthesizeSpeechStream(
    text: string,
    onChunk: (chunk: Buffer) => void,
    signal?: AbortSignal,
): Promise<void> {
    const { url, headers } = await resolveTtsEndpoint(true);
    console.log('[voice] streaming speech synthesis, text length:', text.length);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: ttsRequestBody(text),
        signal: signal ?? null,
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        console.error('[voice] TTS stream API error:', response.status, errText);
        throw new Error(`TTS API error ${response.status}: ${errText}`);
    }
    if (!response.body) {
        throw new Error('TTS API returned no body');
    }

    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
            onChunk(Buffer.from(value));
        }
    }
}
