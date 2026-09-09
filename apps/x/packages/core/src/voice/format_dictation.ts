import { generateText } from 'ai';
import { createLanguageModel } from '../models/models.js';
import { getBackgroundTaskAgentModel, resolveProviderConfig } from '../models/defaults.js';
import { directCallReasoningOptions } from '../models/reasoning.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';

const SYSTEM_PROMPT = `You clean up voice-dictated text into a message ready to post in a team chat (Slack-style).

Rules:
- Remove filler ("um", "uh", "you know"), false starts, and stutter repeats
- Fix punctuation, capitalization, and obvious transcription slips
- Keep the person's words, tone, and meaning - do NOT summarize, rewrite, or add content
- Keep @mentions exactly as they appear (e.g. "@rowboat")
- Only break into paragraphs or a list when the speech clearly has that structure
- Same language as the input
- Output the cleaned message and nothing else`;

// Past this the cleanup payoff shrinks while latency and cost grow — callers
// post the raw transcript instead.
const MAX_INPUT_CHARS = 6000;

/**
 * Clean a raw STT transcript into a postable chat message using the
 * background-agents task model. Returns null when the input is empty or
 * oversized, or the model produced nothing usable — callers fall back to
 * the raw transcript. Model/provider errors propagate to the caller.
 */
export async function formatDictation(transcript: string): Promise<string | null> {
    const text = transcript.trim();
    if (!text || text.length > MAX_INPUT_CHARS) return null;

    const { model: modelId, provider: providerName, effort } = await getBackgroundTaskAgentModel();
    const providerConfig = await resolveProviderConfig(providerName);
    const model = createLanguageModel(providerConfig, modelId);

    // Reasoning models think by default and can starve the output cap — pin
    // thinking to low; an explicit effort on the backgroundTask slot overrides
    // (same posture as the chat-title call).
    const reasoning = await directCallReasoningOptions(providerConfig.flavor, modelId, effort ?? 'low');
    const result = await withUseCase({ useCase: 'copilot_chat', subUseCase: 'spaces_dictation_format' }, () => generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: text,
        maxOutputTokens: 4000,
        ...reasoning,
    }));

    captureLlmUsage({
        useCase: 'copilot_chat',
        subUseCase: 'spaces_dictation_format',
        model: modelId,
        provider: providerName,
        usage: result.usage,
    });

    const formatted = result.text.trim();
    return formatted || null;
}
