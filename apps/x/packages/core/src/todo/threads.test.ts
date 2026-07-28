import { describe, expect, it } from 'vitest';
import { parseThread, renderThreadForContext } from './threads.js';

const SAMPLE = `# build a deck

## rowboat — 2026-07-28T12:36:10.000Z (run tr_abc)

Drafted an outline in knowledge/Projects/deck.md.

## you — 2026-07-28T12:40:02.000Z

Too long — cut it to 8 slides.
And drop the pricing section.
`;

describe('todo threads', () => {
    it('parses entries with authors, timestamps, run ids, and multi-line bodies', () => {
        const entries = parseThread(SAMPLE);
        expect(entries).toEqual([
            {
                author: 'rowboat',
                at: '2026-07-28T12:36:10.000Z',
                text: 'Drafted an outline in knowledge/Projects/deck.md.',
                runId: 'tr_abc',
            },
            {
                author: 'user',
                at: '2026-07-28T12:40:02.000Z',
                text: 'Too long — cut it to 8 slides.\nAnd drop the pricing section.',
            },
        ]);
    });

    it('renders the thread for a follow-up run context', () => {
        const ctx = renderThreadForContext(parseThread(SAMPLE));
        expect(ctx).toContain('YOU (previous run): Drafted an outline');
        expect(ctx).toContain('USER: Too long');
    });

    it('returns nothing for an empty or title-only file', () => {
        expect(parseThread('')).toEqual([]);
        expect(parseThread('# build a deck\n')).toEqual([]);
    });
});
