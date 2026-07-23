import { generateText } from 'ai';
import { createLanguageModel } from '../models/models.js';
import { getChatTitleModel, resolveProviderConfig } from '../models/defaults.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';

const SYSTEM_PROMPT = `You name chat conversations. Given the user's first message, reply with a concise title for the conversation.

Rules:
- 3 to 5 words
- Same language as the message
- No quotation marks, no ending punctuation, no emoji
- Output the title and nothing else`;

// Long first messages are usually pasted documents or code; the opening is
// enough signal for a title and keeps the call cheap.
const MAX_INPUT_CHARS = 500;

const MAX_TITLE_CHARS = 80;

/**
 * Generate a short chat title from the first user message. Returns null when
 * the message is empty or the model produces something unusable — callers
 * keep the truncated-message placeholder in that case.
 */
export async function generateChatTitle(firstMessage: string): Promise<string | null> {
    const text = firstMessage.trim().replace(/\s+/g, ' ');
    if (!text) return null;

    const { model: modelId, provider: providerName } = await getChatTitleModel();
    const providerConfig = await resolveProviderConfig(providerName);
    const model = createLanguageModel(providerConfig, modelId);

    const result = await withUseCase({ useCase: 'copilot_chat', subUseCase: 'chat_title' }, () => generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: text.slice(0, MAX_INPUT_CHARS),
        maxOutputTokens: 50,
    }));

    captureLlmUsage({
        useCase: 'copilot_chat',
        subUseCase: 'chat_title',
        model: modelId,
        provider: providerName,
        usage: result.usage,
    });

    const title = result.text
        .trim()
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
        .replace(/[.!。]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!title || title.length > MAX_TITLE_CHARS) return null;
    return title;
}
