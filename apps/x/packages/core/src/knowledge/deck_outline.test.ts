import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deck } from '@x/shared';

// Mock the model plumbing (same seams the module uses); the tests drive the
// generation through generateText's return values.
const generateTextMock = vi.fn<(args: { prompt: string }) => Promise<{ text: string; usage: object }>>();
vi.mock('ai', () => ({
    generateText: (args: { prompt: string }) => generateTextMock(args),
}));
vi.mock('../models/defaults.js', () => ({
    getDefaultModelAndProvider: vi.fn(async () => ({ provider: 'openai', model: 'test-model' })),
    resolveProviderConfig: vi.fn(async () => ({ flavor: 'openai' })),
}));
vi.mock('../models/models.js', () => ({
    createLanguageModel: vi.fn(() => ({ modelId: 'test-model' })),
}));
vi.mock('../models/reasoning.js', () => ({
    directCallReasoningOptions: vi.fn(async () => ({})),
}));
vi.mock('../analytics/usage.js', () => ({
    captureLlmUsage: vi.fn(),
}));

import { DeckOutlineError, generateDeckOutline } from './deck_outline.js';

const GOOD_OUTLINE: deck.DeckOutline = {
    title: 'Q3 Review',
    suggestedPalette: 'navy',
    slides: [
        { layout: 'title', heading: 'Q3 Review', body: 'What we shipped and learned' },
        { layout: 'title-body', heading: 'Revenue grew 40%', bullets: ['New pricing landed', 'Churn flat'] },
        { layout: 'title-body', heading: 'Next: double down on onboarding', speakerNotes: 'Close with the ask.' },
    ],
};

function respondWith(...texts: string[]) {
    for (const text of texts) {
        generateTextMock.mockResolvedValueOnce({ text, usage: {} });
    }
}

beforeEach(() => {
    generateTextMock.mockReset();
});

describe('DeckOutline schema', () => {
    it('accepts a good outline', () => {
        expect(deck.DeckOutline.safeParse(GOOD_OUTLINE).success).toBe(true);
    });

    it('rejects malformed outlines', () => {
        const bad: unknown[] = [
            { ...GOOD_OUTLINE, title: undefined },
            { ...GOOD_OUTLINE, title: '' },
            { ...GOOD_OUTLINE, suggestedPalette: 'neon' },
            { ...GOOD_OUTLINE, slides: [] },
            { ...GOOD_OUTLINE, slides: [{ layout: 'two-column', heading: 'X' }] },
            { ...GOOD_OUTLINE, slides: [{ layout: 'title' }] },
        ];
        for (const outline of bad) {
            expect(deck.DeckOutline.safeParse(outline).success, JSON.stringify(outline)).toBe(false);
        }
    });

    it('caps clarifyingQuestions at 2', () => {
        const twoQs = { ...GOOD_OUTLINE, clarifyingQuestions: ['Audience?', 'How long?'] };
        expect(deck.DeckOutline.safeParse(twoQs).success).toBe(true);
        const threeQs = { ...GOOD_OUTLINE, clarifyingQuestions: ['A?', 'B?', 'C?'] };
        expect(deck.DeckOutline.safeParse(threeQs).success).toBe(false);
    });
});

describe('generateDeckOutline', () => {
    it('returns the parsed outline from a valid first response', async () => {
        respondWith(JSON.stringify(GOOD_OUTLINE));
        const outline = await generateDeckOutline({ prompt: 'Q3 review deck' });
        expect(outline).toEqual(GOOD_OUTLINE);
        expect(generateTextMock).toHaveBeenCalledTimes(1);
        const { prompt } = generateTextMock.mock.calls[0][0];
        expect(prompt).toContain('Q3 review deck');
    });

    it('strips markdown fences around the JSON', async () => {
        respondWith('```json\n' + JSON.stringify(GOOD_OUTLINE) + '\n```');
        await expect(generateDeckOutline({ prompt: 'p' })).resolves.toEqual(GOOD_OUTLINE);
    });

    it('passes slideCount, tone and answers through to the prompt', async () => {
        respondWith(JSON.stringify(GOOD_OUTLINE));
        await generateDeckOutline({
            prompt: 'pitch deck',
            slideCount: 8,
            tone: 'playful',
            answers: ['Investors', '10 minutes'],
        });
        const { prompt } = generateTextMock.mock.calls[0][0];
        expect(prompt).toContain('Target slide count: 8');
        expect(prompt).toContain('Tone: playful');
        expect(prompt).toContain('1. Investors');
        expect(prompt).toContain('2. 10 minutes');
    });

    it('repairs once: invalid first response, valid second', async () => {
        const invalid = JSON.stringify({ ...GOOD_OUTLINE, suggestedPalette: 'neon' });
        respondWith(invalid, JSON.stringify(GOOD_OUTLINE));

        const outline = await generateDeckOutline({ prompt: 'p' });
        expect(outline).toEqual(GOOD_OUTLINE);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
        // The repair prompt carries the previous output and what was wrong.
        const { prompt } = generateTextMock.mock.calls[1][0];
        expect(prompt).toContain('Problems: suggestedPalette');
        expect(prompt).toContain(invalid);
        expect(prompt).toContain('ONLY the corrected JSON object');
    });

    it('throws a typed error when the repair attempt is also invalid', async () => {
        respondWith('not json at all', '{"still": "wrong"}');
        const pending = generateDeckOutline({ prompt: 'p' });
        await expect(pending).rejects.toBeInstanceOf(DeckOutlineError);
        await expect(pending).rejects.toMatchObject({ name: 'DeckOutlineError' });
        expect(generateTextMock).toHaveBeenCalledTimes(2);
    });

    it('does not repair a response that is already valid JSON with 3 clarifying questions', async () => {
        // Over-limit clarifyingQuestions is a schema violation → repair path.
        const overLimit = JSON.stringify({ ...GOOD_OUTLINE, clarifyingQuestions: ['A?', 'B?', 'C?'] });
        respondWith(overLimit, JSON.stringify({ ...GOOD_OUTLINE, clarifyingQuestions: ['A?', 'B?'] }));
        const outline = await generateDeckOutline({ prompt: 'p' });
        expect(outline.clarifyingQuestions).toEqual(['A?', 'B?']);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
    });
});
