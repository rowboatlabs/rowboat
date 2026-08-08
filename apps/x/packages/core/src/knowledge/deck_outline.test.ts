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

/** A first-turn clarify response: 1-2 questions, no slides. */
const CLARIFY_OUTLINE: deck.DeckOutline = {
    title: 'Draft',
    suggestedPalette: 'navy',
    clarifyingQuestions: ['Who is the audience?', 'How deep should it go?'],
    slides: [],
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
    it('accepts a full outline (slides, no questions)', () => {
        expect(deck.DeckOutline.safeParse(GOOD_OUTLINE).success).toBe(true);
    });

    it('accepts a clarify response (1-2 questions, no slides)', () => {
        expect(deck.DeckOutline.safeParse(CLARIFY_OUTLINE).success).toBe(true);
        const oneQ = { ...CLARIFY_OUTLINE, clarifyingQuestions: ['Who is the audience?'] };
        expect(deck.DeckOutline.safeParse(oneQ).success).toBe(true);
    });

    it('rejects questions and slides together', () => {
        const both = { ...GOOD_OUTLINE, clarifyingQuestions: ['Audience?'] };
        expect(deck.DeckOutline.safeParse(both).success).toBe(false);
    });

    it('rejects an empty outline with no questions', () => {
        expect(deck.DeckOutline.safeParse({ ...GOOD_OUTLINE, slides: [] }).success).toBe(false);
        const emptyQs = { ...CLARIFY_OUTLINE, clarifyingQuestions: [] };
        expect(deck.DeckOutline.safeParse(emptyQs).success).toBe(false);
    });

    it('rejects more than 2 clarifying questions', () => {
        const threeQs = { ...CLARIFY_OUTLINE, clarifyingQuestions: ['A?', 'B?', 'C?'] };
        expect(deck.DeckOutline.safeParse(threeQs).success).toBe(false);
    });

    it('rejects malformed outlines', () => {
        const bad: unknown[] = [
            { ...GOOD_OUTLINE, title: undefined },
            { ...GOOD_OUTLINE, title: '' },
            { ...GOOD_OUTLINE, suggestedPalette: 'neon' },
            { ...GOOD_OUTLINE, slides: [{ layout: 'two-column', heading: 'X' }] },
            { ...GOOD_OUTLINE, slides: [{ layout: 'title' }] },
        ];
        for (const outline of bad) {
            expect(deck.DeckOutline.safeParse(outline).success, JSON.stringify(outline)).toBe(false);
        }
    });

    it('accepts every pattern with its pattern-specific payload', () => {
        const slides: deck.DeckOutlineSlide[] = [
            { layout: 'title', pattern: 'title', heading: 'Deck', body: 'Subtitle' },
            { layout: 'title-body', pattern: 'section', heading: 'Part one' },
            { layout: 'title-body', pattern: 'bullets', heading: 'Facts', bullets: ['a', 'b'] },
            {
                layout: 'title-body', pattern: 'two-column', heading: 'Compare',
                columns: [{ heading: 'L', lines: ['l1'] }, { heading: 'R', lines: ['r1'] }],
            },
            { layout: 'title-body', pattern: 'big-number', heading: 'Growth', stat: { value: '312%', caption: 'YoY' } },
            { layout: 'title-body', pattern: 'quote', heading: 'Voice', quote: { text: 'Wow.', attribution: 'A user' } },
            { layout: 'title-body', pattern: 'closing', heading: 'Thanks' },
        ];
        expect(deck.DeckOutline.safeParse({ ...GOOD_OUTLINE, slides }).success).toBe(true);
    });

    it('rejects unknown patterns and malformed pattern payloads', () => {
        const bad: unknown[] = [
            // Unknown pattern value.
            { ...GOOD_OUTLINE, slides: [{ layout: 'title-body', pattern: 'timeline', heading: 'X' }] },
            // columns missing its required lines array.
            { ...GOOD_OUTLINE, slides: [{ layout: 'title-body', pattern: 'two-column', heading: 'X', columns: [{ heading: 'L' }] }] },
            // stat missing caption.
            { ...GOOD_OUTLINE, slides: [{ layout: 'title-body', pattern: 'big-number', heading: 'X', stat: { value: '9x' } }] },
            // quote missing text.
            { ...GOOD_OUTLINE, slides: [{ layout: 'title-body', pattern: 'quote', heading: 'X', quote: { attribution: 'A' } }] },
        ];
        for (const outline of bad) {
            expect(deck.DeckOutline.safeParse(outline).success, JSON.stringify(outline)).toBe(false);
        }
    });
});

describe('generateDeckOutline', () => {
    it('returns a clarify response (questions, no slides) on the first turn', async () => {
        respondWith(JSON.stringify(CLARIFY_OUTLINE));
        const outline = await generateDeckOutline({ prompt: 'a deck about our roadmap' });
        expect(outline.clarifyingQuestions).toEqual(CLARIFY_OUTLINE.clarifyingQuestions);
        expect(outline.slides).toEqual([]);
        expect(generateTextMock).toHaveBeenCalledTimes(1);
        // The first-turn user prompt asks the model to clarify first.
        const { prompt } = generateTextMock.mock.calls[0][0];
        expect(prompt).toContain('TURN 1: clarify first');
    });

    it('returns the full outline when a fully-specified prompt skips questions', async () => {
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

    it('marks the second turn and passes slideCount, tone and answers through', async () => {
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
        expect(prompt).toContain('TURN 2');
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

    it('repairs a response that returns questions AND slides together', async () => {
        // The XOR rule is a schema violation → repair path; the model then
        // returns a clean clarify response.
        const both = JSON.stringify({ ...GOOD_OUTLINE, clarifyingQuestions: ['A?', 'B?'] });
        respondWith(both, JSON.stringify(CLARIFY_OUTLINE));
        const outline = await generateDeckOutline({ prompt: 'p' });
        expect(outline.clarifyingQuestions).toEqual(CLARIFY_OUTLINE.clarifyingQuestions);
        expect(outline.slides).toEqual([]);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
        const { prompt } = generateTextMock.mock.calls[1][0];
        expect(prompt).toContain('Problems: slides');
    });
});
