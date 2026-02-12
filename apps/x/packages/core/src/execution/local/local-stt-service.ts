import fs from "fs";
import path from "path";
import { ISttService } from "../stt-service.js";
import { WorkDir } from "../../config/config.js";

export class LocalSttService implements ISttService {
    async transcribe(audioBase64: string, mimeType: string): Promise<string | null> {
        try {
            const configPath = path.join(WorkDir, 'config', 'deepgram.json');
            if (!fs.existsSync(configPath)) {
                throw new Error('Deepgram config not found');
            }

            const configData = fs.readFileSync(configPath, 'utf-8');
            const { apiKey } = JSON.parse(configData) as { apiKey: string };
            if (!apiKey) throw new Error('No apiKey in deepgram.json');

            const audioBuffer = Buffer.from(audioBase64, 'base64');

            const response = await fetch(
                'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Token ${apiKey}`,
                        'Content-Type': mimeType,
                    },
                    body: audioBuffer,
                },
            );

            if (!response.ok) throw new Error(`Deepgram API error: ${response.status}`);
            const result = await response.json() as {
                results?: {
                    channels?: Array<{
                        alternatives?: Array<{ transcript?: string }>;
                    }>;
                };
            };
            return result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? null;
        } catch (err) {
            console.error('Deepgram transcription failed:', err);
            return null;
        }
    }
}
