import { generateText } from 'ai';
import { deck } from '@x/shared';
import { createLanguageModel } from '../models/models.js';
import { getDefaultModelAndProvider, resolveProviderConfig } from '../models/defaults.js';
import { directCallReasoningOptions } from '../models/reasoning.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';

// One-shot deck outline generation: user prompt in, zod-validated outline
// out. Same direct-call pattern as classifySchedule (inline_tasks.ts) and
// summarizeMeeting: resolve the user's configured default model, one
// generateText, JSON-only response. On invalid output the model gets ONE
// repair attempt (its own output + the validation problems), then the
// caller sees a typed DeckOutlineError.

const SYSTEM_PROMPT = `You help someone draft a slide deck. You always work in TWO turns:

TURN 1 (no answers yet) — CLARIFY FIRST.
Ask 1-2 short clarifying questions and return NO slides. This is the norm, not the exception: a good deck depends on who it is for and how deep to go, so ask before drafting.
- Prefer asking about (a) the AUDIENCE and (b) the desired DEPTH or LENGTH.
- Skip a question only when the prompt ALREADY answers it explicitly; ask about whatever is still unspecified.
- Only when the prompt is fully specified (audience AND depth/length both clear) may you skip questions entirely and go straight to the full outline in this turn.
Return: { "title", "suggestedPalette", "clarifyingQuestions": [1-2 short questions], "slides": [] }

TURN 2 (answers provided) — FULL OUTLINE.
Use the answers to write the complete outline. Return NO clarifyingQuestions.
Return: { "title", "suggestedPalette", "slides": [ ... ] }

Never return clarifyingQuestions AND slides together. Respond with ONLY a JSON object — no prose, no markdown fences — of this shape:
{
  "title": string,                       // short deck title
  "suggestedPalette": "navy" | "warm" | "mono",
  "clarifyingQuestions": string[],       // TURN 1 only, 1-2 questions; OMIT on a full outline
  "slides": [                            // omit / empty on a clarify turn
    {
      "layout": "title" | "title-body",
      "heading": string,
      "bullets": string[],               // OPTIONAL
      "body": string,                    // OPTIONAL short paragraph, alternative to bullets
      "speakerNotes": string             // OPTIONAL
    }
  ]
}

Deck-writing rules (for the full outline):
- Punchy, specific headings — a claim or takeaway, not a topic label.
- At most 3-5 bullets per slide; each one short line, never a wall of text.
- Prefer bullets; use "body" only for a short narrative moment (or the title slide's subtitle).
- The FIRST slide must use layout "title": the deck title as its heading, an optional subtitle as "body".
- The LAST slide is a closing — recap, call to action, or thank-you.
- Middle slides use layout "title-body".
- Pick suggestedPalette by subject: "navy" professional/corporate, "warm" human/creative, "mono" minimal/technical.
- Add speakerNotes (1-3 spoken sentences) only where they add value.`;

/** The model failed to produce a valid outline even after the repair round. */
export class DeckOutlineError extends Error {
    /** Validation problems from the last attempt, for logs/diagnostics. */
    readonly detail?: string;

    constructor(message: string, detail?: string) {
        super(message);
        this.name = 'DeckOutlineError';
        this.detail = detail;
    }
}

export type GenerateDeckOutlineInput = deck.GenerateDeckOutlineRequest;

/** Strip markdown code fences if the LLM wraps the JSON (same as classifySchedule). */
function stripCodeFences(text: string): string {
    return text
        .trim()
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
}

function parseOutline(raw: string): { outline: deck.DeckOutline } | { issue: string } {
    let data: unknown;
    try {
        data = JSON.parse(stripCodeFences(raw));
    } catch (err) {
        return { issue: `not valid JSON (${err instanceof Error ? err.message : String(err)})` };
    }
    const parsed = deck.DeckOutline.safeParse(data);
    if (!parsed.success) {
        return {
            issue: parsed.error.issues
                .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
                .join('; '),
        };
    }
    return { outline: parsed.data };
}

function buildUserPrompt(input: GenerateDeckOutlineInput): string {
    const hasAnswers = Boolean(input.answers && input.answers.length > 0);
    const lines = ['Create a slide deck outline for this request:', '', input.prompt];
    if (input.slideCount) {
        lines.push('', `Target slide count: ${input.slideCount} (including the title and closing slides).`);
    }
    if (input.tone) {
        lines.push('', `Tone: ${input.tone}`);
    }
    if (hasAnswers) {
        lines.push('', 'Answers to your clarifying questions:');
        lines.push(...input.answers!.map((a, i) => `${i + 1}. ${a}`));
        lines.push('', 'This is TURN 2: return the full outline and no clarifyingQuestions.');
    } else {
        lines.push('', 'This is TURN 1: clarify first — ask 1-2 questions and return no slides, unless the request already specifies both the audience and the desired depth/length.');
    }
    return lines.join('\n');
}

export async function generateDeckOutline(input: GenerateDeckOutlineInput): Promise<deck.DeckOutline> {
    const selection = await getDefaultModelAndProvider();
    const providerConfig = await resolveProviderConfig(selection.provider);
    const model = createLanguageModel(providerConfig, selection.model);
    const reasoning = await directCallReasoningOptions(providerConfig.flavor, selection.model, selection.effort);

    const call = async (prompt: string): Promise<string> => {
        const result = await withUseCase({ useCase: 'app_llm_generate', subUseCase: 'deck_outline' }, () => generateText({
            model,
            instructions: SYSTEM_PROMPT,
            prompt,
            ...reasoning,
        }));
        captureLlmUsage({
            useCase: 'app_llm_generate',
            subUseCase: 'deck_outline',
            model: selection.model,
            provider: selection.provider,
            usage: result.usage,
        });
        return result.text;
    };

    const userPrompt = buildUserPrompt(input);
    const first = await call(userPrompt);
    const attempt = parseOutline(first);
    if ('outline' in attempt) return attempt.outline;

    // One repair round: the model sees its own output and what was wrong
    // with it, and must answer with corrected JSON only.
    const repairPrompt = [
        userPrompt,
        '',
        'Your previous response was not a valid outline JSON object.',
        `Problems: ${attempt.issue}`,
        '',
        'Your previous response:',
        first.trim(),
        '',
        'Respond again with ONLY the corrected JSON object.',
    ].join('\n');
    const second = await call(repairPrompt);
    const repaired = parseOutline(second);
    if ('outline' in repaired) return repaired.outline;

    throw new DeckOutlineError('The model did not produce a valid deck outline', repaired.issue);
}
