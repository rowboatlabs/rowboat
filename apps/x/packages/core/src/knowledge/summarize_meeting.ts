import { generateText } from 'ai';
import container from '../di/container.js';
import type { IModelConfigRepo } from '../models/repo.js';
import { createProvider } from '../models/models.js';

const SYSTEM_PROMPT = `You are a meeting notes assistant. Given a raw meeting transcript, create concise, well-organized meeting notes.

Format rules:
- Use ### for section headers that group related discussion topics
- Section headers should be in sentence case (e.g. "### Onboarding flow status"), NOT Title Case
- Use bullet points with sub-bullets for details
- Include a "### Action items" section at the end if any were discussed
- Focus on decisions, key discussions, and takeaways — not verbatim quotes
- Attribute statements to speakers when relevant (use their names/labels from the transcript)
- Keep it concise — the notes should be much shorter than the transcript
- Output markdown only, no preamble or explanation`;

export async function summarizeMeeting(transcript: string): Promise<string> {
    const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
    const config = await repo.getConfig();
    const provider = createProvider(config.provider);
    const model = provider.languageModel(config.model);

    const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: transcript,
    });

    return result.text.trim();
}
