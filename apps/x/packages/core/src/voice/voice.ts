import * as fs from 'fs/promises';
import * as path from 'path';
import { isSignedIn } from '../account/account.js';
import { getAccessToken } from '../auth/tokens.js';
import { WorkDir } from '../config/config.js';
import { API_URL } from '../config/env.js';
import { getRemoteConfig } from '../config/remote-config.js';

export interface VoiceConfig {
    deepgram: { apiKey: string } | null;
    elevenlabs: { apiKey: string; voiceId?: string } | null;
}

const DEFAULT_VOICE_ID = 's3TPKV1kjDlVtZbl4Ksh';

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

async function resolveTtsEndpoint(streaming: boolean, voiceIdOverride?: string): Promise<{ url: string; headers: Record<string, string> }> {
    const config = await getVoiceConfig();
    const signedIn = await isSignedIn();

    if (signedIn) {
        const voiceId = voiceIdOverride || config.elevenlabs?.voiceId || DEFAULT_VOICE_ID;
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
    const voiceId = voiceIdOverride || config.elevenlabs.voiceId || DEFAULT_VOICE_ID;
    return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}${streaming ? '/stream' : ''}`,
        headers: {
            'xi-api-key': config.elevenlabs.apiKey,
            'Content-Type': 'application/json',
        },
    };
}

// Default stays flash: the streaming path feeds live voice mode where
// latency wins. Produced audio (the text-to-speech tool, app voice API)
// passes eleven_turbo_v2_5 for noticeably better quality.
function ttsRequestBody(text: string, modelId?: string): string {
    return JSON.stringify({
        text,
        model_id: modelId || 'eleven_flash_v2_5',
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
        },
    });
}

export async function synthesizeSpeech(text: string, opts?: { voiceId?: string; modelId?: string }): Promise<{ audioBase64: string; mimeType: string }> {
    const { url, headers } = await resolveTtsEndpoint(false, opts?.voiceId);
    console.log('[voice] synthesizing speech, text length:', text.length);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: ttsRequestBody(text, opts?.modelId),
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

// ---------------------------------------------------------------------------
// Batch ASR — transcribe a complete audio buffer (not live mic streaming).
// Auth precedence mirrors the renderer's voice mode: signed-in Rowboat
// account first, then a local Deepgram key.
// ---------------------------------------------------------------------------

// No encoding/sample_rate params: Deepgram auto-detects containerized audio
// (wav, mp3, ogg/opus, webm — what MediaRecorder and TTS produce).
const ASR_PARAMS = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
    language: 'multi',
});

const ASR_WS_CHUNK_BYTES = 32 * 1024;
const ASR_WS_CHUNK_DELAY_MS = 10;
const ASR_TIMEOUT_MS = 180_000;

export async function transcribeAudio(audio: Buffer, opts?: { mimeType?: string }): Promise<{ transcript: string }> {
    if (audio.length === 0) throw new Error('audio buffer is empty');
    console.log('[voice] transcribing audio, bytes:', audio.length);

    if (await isSignedIn()) {
        return transcribeViaProxy(audio);
    }

    const config = await getVoiceConfig();
    if (!config.deepgram) {
        throw new Error(`Deepgram not configured. Sign in to Rowboat, or create ${path.join(WorkDir, 'config', 'deepgram.json')} with { "apiKey": "<your-key>" }`);
    }

    // Local key: Deepgram's pre-recorded REST API (most robust for files).
    const response = await fetch(`https://api.deepgram.com/v1/listen?${ASR_PARAMS.toString()}`, {
        method: 'POST',
        headers: {
            'Authorization': `Token ${config.deepgram.apiKey}`,
            'Content-Type': opts?.mimeType || 'application/octet-stream',
        },
        body: new Uint8Array(audio),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`ASR API error ${response.status}: ${errText}`);
    }
    const result = await response.json() as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return { transcript: transcript.trim() };
}

/**
 * Signed-in path: the account WS proxy only exposes Deepgram's live API, so
 * the buffer is streamed through it in chunks and the final transcripts are
 * collected until the server closes after CloseStream.
 */
async function transcribeViaProxy(audio: Buffer): Promise<{ transcript: string }> {
    const { websocketApiUrl } = await getRemoteConfig();
    if (!websocketApiUrl) throw new Error('Rowboat websocket API URL is not configured');
    const accessToken = await getAccessToken();

    const url = new URL('/deepgram/v1/listen', websocketApiUrl);
    for (const [key, value] of ASR_PARAMS) url.searchParams.set(key, value);

    return new Promise<{ transcript: string }>((resolve, reject) => {
        const ws = new WebSocket(url.toString(), ['bearer', accessToken]);
        const finals: string[] = [];
        let settled = false;

        const finish = (err?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { ws.close(); } catch { /* already closed */ }
            if (err) reject(err);
            else resolve({ transcript: finals.join(' ').replace(/\s+/g, ' ').trim() });
        };
        const timeout = setTimeout(
            () => finish(new Error(`ASR timed out after ${ASR_TIMEOUT_MS}ms`)),
            ASR_TIMEOUT_MS,
        );

        ws.onopen = () => {
            void (async () => {
                try {
                    for (let offset = 0; offset < audio.length; offset += ASR_WS_CHUNK_BYTES) {
                        if (settled) return;
                        ws.send(new Uint8Array(audio.subarray(offset, offset + ASR_WS_CHUNK_BYTES)));
                        await new Promise((r) => setTimeout(r, ASR_WS_CHUNK_DELAY_MS));
                    }
                    ws.send(JSON.stringify({ type: 'CloseStream' }));
                } catch (e) {
                    finish(e instanceof Error ? e : new Error(String(e)));
                }
            })();
        };
        ws.onmessage = (event: MessageEvent) => {
            if (typeof event.data !== 'string') return;
            try {
                const msg = JSON.parse(event.data) as {
                    type?: string;
                    is_final?: boolean;
                    channel?: { alternatives?: Array<{ transcript?: string }> };
                };
                if (msg.type === 'Results' && msg.is_final) {
                    const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
                    if (text.trim()) finals.push(text.trim());
                }
            } catch { /* ignore non-JSON frames */ }
        };
        ws.onerror = () => finish(new Error('ASR websocket error (proxy connection failed)'));
        ws.onclose = () => finish();
    });
}
