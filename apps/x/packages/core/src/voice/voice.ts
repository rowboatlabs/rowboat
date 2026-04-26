import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkDir } from '../config/config.js';

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

export async function synthesizeSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    const config = await getVoiceConfig();

    if (!config.elevenlabs) {
        throw new Error(`ElevenLabs not configured. Create ${path.join(WorkDir, 'config', 'elevenlabs.json')} with { "apiKey": "<your-key>" }`);
    }
    const voiceId = config.elevenlabs.voiceId || 'UgBBYS2sOqTuMpoF3BR0';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const headers: Record<string, string> = {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
    };
    console.log('[voice] synthesizing speech via ElevenLabs, text length:', text.length, 'voiceId:', voiceId);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            text,
            model_id: 'eleven_flash_v2_5',
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
            },
        }),
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
