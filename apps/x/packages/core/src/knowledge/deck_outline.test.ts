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

import { DeckOutlineError, editSlide, generateDeckOutline, generateSlide } from './deck_outline.js';

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

    it('sizes clarifying questions to the gap: up to 8, not more', () => {
        const five = { ...CLARIFY_OUTLINE, clarifyingQuestions: ['A?', 'B?', 'C?', 'D?', 'E?'] };
        expect(deck.DeckOutline.safeParse(five).success).toBe(true);
        const nine = { ...CLARIFY_OUTLINE, clarifyingQuestions: Array.from({ length: 9 }, (_, i) => `Q${i}?`) };
        expect(deck.DeckOutline.safeParse(nine).success).toBe(false);
    });

    it('accepts needsInput labels on a slide', () => {
        const withNeeds = {
            ...GOOD_OUTLINE,
            slides: [
                { ...GOOD_OUTLINE.slides[0] },
                {
                    layout: 'title-body' as const,
                    pattern: 'big-number' as const,
                    heading: 'Growth',
                    stat: { value: '[X]%', caption: 'MoM growth' },
                    needsInput: ['MoM growth %'],
                },
            ],
        };
        expect(deck.DeckOutline.safeParse(withNeeds).success).toBe(true);
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

    it('pins the anti-fabrication rules into every generation prompt', async () => {
        // The rules ride in the system prompt (generateText's `instructions`);
        // this pins them so they cannot silently regress.
        respondWith(JSON.stringify(GOOD_OUTLINE));
        await generateDeckOutline({ prompt: 'p' });
        respondWith(JSON.stringify(GOOD_OUTLINE.slides[1]));
        await generateSlide({ deckContext: { title: 'T', slides: [] }, position: 0 });
        respondWith(JSON.stringify(GOOD_OUTLINE.slides[1]));
        await editSlide({ slide: GOOD_OUTLINE.slides[1], instruction: 'i', deckContext: { title: 'T', slides: [] } });

        for (const call of generateTextMock.mock.calls) {
            const { instructions } = call[0] as unknown as { instructions: string };
            expect(instructions).toContain('Never invent numbers, statistics, valuations, dates, names, customer counts, or quotes');
            expect(instructions).toContain('square-bracket placeholder');
            expect(instructions).toContain('ONLY when the user supplied the number');
        }
    });

    it('carries the honest no-metrics shapes through: a metrics question, or a bracketed stat with needsInput', async () => {
        // Shape A — the model asks for the number instead of inventing it
        // (>2 questions: gap-sized, not capped at 2).
        const askingClarify: deck.DeckOutline = {
            title: 'Pitch',
            suggestedPalette: 'navy',
            clarifyingQuestions: [
                'Who is the audience?',
                'How long is the talk?',
                'What growth metrics can you share?',
            ],
            slides: [],
        };
        respondWith(JSON.stringify(askingClarify));
        const clarify = await generateDeckOutline({ prompt: 'a pitch deck for my startup' });
        expect(clarify.clarifyingQuestions).toHaveLength(3);
        expect(clarify.slides).toEqual([]);

        // Shape B — turn 2 without the number: a visibly-bracketed placeholder
        // plus needsInput, never a plausible-looking value.
        const placeholderOutline: deck.DeckOutline = {
            title: 'Pitch',
            suggestedPalette: 'navy',
            slides: [
                { layout: 'title', pattern: 'title', heading: 'Pitch' },
                {
                    layout: 'title-body',
                    pattern: 'big-number',
                    heading: 'Traction',
                    stat: { value: '[X]%', caption: '[metric] month-over-month' },
                    needsInput: ['MoM growth %'],
                },
                { layout: 'title-body', pattern: 'closing', heading: 'Thanks' },
            ],
        };
        respondWith(JSON.stringify(placeholderOutline));
        const outline = await generateDeckOutline({ prompt: 'a pitch deck', answers: ['investors', '10 min', 'no numbers yet'] });
        const stat = outline.slides[1].stat!;
        expect(stat.value).toBe('[X]%');
        expect(stat.value).toMatch(/^\[.*\]/);
        expect(outline.slides[1].needsInput).toEqual(['MoM growth %']);
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

describe('generateSlide', () => {
    const GOOD_SLIDE: deck.DeckOutlineSlide = {
        layout: 'title-body',
        pattern: 'big-number',
        heading: 'Adoption is accelerating',
        stat: { value: '312%', caption: 'YoY growth' },
    };
    const CONTEXT: deck.DeckContext = {
        title: 'Q3 Review',
        slides: [
            { heading: 'Q3 Review', bullets: ['What we shipped'] },
            { heading: 'Revenue grew 40%', bullets: ['New pricing', 'Churn flat'] },
        ],
    };

    it('returns a validated single slide and feeds the context into the prompt', async () => {
        respondWith(JSON.stringify(GOOD_SLIDE));
        const slide = await generateSlide({ deckContext: CONTEXT, topic: 'growth metric', position: 2 });
        expect(slide).toEqual(GOOD_SLIDE);
        expect(generateTextMock).toHaveBeenCalledTimes(1);
        const { prompt } = generateTextMock.mock.calls[0][0];
        expect(prompt).toContain('Deck title: Q3 Review');
        expect(prompt).toContain('Revenue grew 40% — New pricing; Churn flat');
        expect(prompt).toContain('Topic for the new slide: growth metric');
        expect(prompt).toContain('position 3 of 3');
    });

    it('asks the model to suggest a slide when no topic is given', async () => {
        respondWith(JSON.stringify({ ...GOOD_SLIDE, pattern: 'section', heading: 'Where we are next' }));
        await generateSlide({ deckContext: CONTEXT, position: 1 });
        const { prompt } = generateTextMock.mock.calls[0][0];
        expect(prompt).toContain('No topic was given');
    });

    it('repairs one malformed response then returns the slide', async () => {
        const bad = JSON.stringify({ ...GOOD_SLIDE, pattern: 'timeline' }); // unknown pattern
        respondWith(bad, JSON.stringify(GOOD_SLIDE));
        const slide = await generateSlide({ deckContext: CONTEXT, topic: 't', position: 0 });
        expect(slide).toEqual(GOOD_SLIDE);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
        expect(generateTextMock.mock.calls[1][0].prompt).toContain('single slide');
    });

    it('throws a typed error when the repair is also malformed', async () => {
        respondWith('not json', '{"layout":"title-body"}'); // missing heading
        const pending = generateSlide({ deckContext: CONTEXT, topic: 't', position: 0 });
        await expect(pending).rejects.toBeInstanceOf(DeckOutlineError);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
    });
});

describe('editSlide', () => {
    const CURRENT: deck.DeckOutlineSlide = {
        layout: 'title-body',
        pattern: 'big-number',
        heading: 'Growth',
        stat: { value: '15%', caption: 'MoM growth' },
    };
    const EDITED: deck.DeckOutlineSlide = {
        ...CURRENT,
        stat: { value: '200%', caption: 'MoM growth' },
    };
    const CONTEXT: deck.DeckContext = {
        title: 'Q3 Review',
        slides: [{ heading: 'Growth', bullets: [] }],
    };

    it('returns the edited slide and feeds slide + instruction into the prompt', async () => {
        respondWith(JSON.stringify(EDITED));
        const slide = await editSlide({ slide: CURRENT, instruction: 'change 15% to 200%', deckContext: CONTEXT });
        expect(slide).toEqual(EDITED);
        expect(generateTextMock).toHaveBeenCalledTimes(1);
        const { prompt } = generateTextMock.mock.calls[0][0];
        expect(prompt).toContain('Current slide:');
        expect(prompt).toContain('"15%"');
        expect(prompt).toContain('Instruction: change 15% to 200%');
        expect(prompt).toContain('Deck title: Q3 Review');
    });

    it('repairs one malformed response', async () => {
        respondWith('```json\n{"nope":true}\n```', JSON.stringify(EDITED));
        const slide = await editSlide({ slide: CURRENT, instruction: 'i', deckContext: CONTEXT });
        expect(slide).toEqual(EDITED);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
        expect(generateTextMock.mock.calls[1][0].prompt).toContain('Problems:');
    });

    it('throws a typed error when the repair is also invalid', async () => {
        respondWith('nope', 'still nope');
        const pending = editSlide({ slide: CURRENT, instruction: 'i', deckContext: CONTEXT });
        await expect(pending).rejects.toBeInstanceOf(DeckOutlineError);
        expect(generateTextMock).toHaveBeenCalledTimes(2);
    });
});
