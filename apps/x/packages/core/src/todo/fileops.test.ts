import { describe, expect, it } from 'vitest';
import { isDelegated, normalizeKey, parseTodoFile, serializeTodoFile } from './fileops.js';

const SAMPLE = `- [ ] build a deck
- [x] @rowboat research pricing models
  - → [Pricing research](knowledge/Topics/pricing.md) — 9 tools compared, 3 viable models
- [ ] @rowboat draft replies to investor emails
  - → needs you: reply to Maya first, or wait for the call?
- [ ] call the bank
  - → failed: Gmail sync is disconnected

## Notes

Some freeform text the user wrote by hand.
`;

describe('todo fileops parse/serialize', () => {
    it('round-trips byte-for-byte and is idempotent', () => {
        const once = serializeTodoFile(parseTodoFile(SAMPLE));
        expect(once).toEqual(SAMPLE);
        expect(serializeTodoFile(parseTodoFile(once))).toEqual(once);
    });

    it('parses items, receipts, and preserves raw blocks', () => {
        const list = parseTodoFile(SAMPLE);
        const items = list.blocks.filter(b => b.kind === 'item').map(b => b.item);
        expect(items).toHaveLength(4);
        expect(items.map(i => i.delegated)).toEqual([false, true, true, false]);
        expect(items.map(i => i.checked)).toEqual([false, true, false, false]);
        expect(items.flatMap(i => i.receipts.map(r => r.kind))).toEqual(['result', 'question', 'error']);
        expect(items[1].receipts[0].links).toEqual([
            { label: 'Pricing research', path: 'knowledge/Topics/pricing.md' },
        ]);
        expect(items[2].receipts[0].text).toEqual('reply to Maya first, or wait for the call?');
        const raws = list.blocks.filter(b => b.kind === 'raw').map(b => b.text);
        expect(raws).toContain('## Notes');
        expect(raws).toContain('Some freeform text the user wrote by hand.');
    });

    it('classifies url vs path links', () => {
        const list = parseTodoFile('- [x] @rowboat find sources\n  - → [MDN](https://developer.mozilla.org), [notes](knowledge/Topics/x.md)\n');
        const item = list.blocks[0];
        if (item.kind !== 'item') throw new Error('expected item');
        expect(item.item.receipts[0].links).toEqual([
            { label: 'MDN', url: 'https://developer.mozilla.org' },
            { label: 'notes', path: 'knowledge/Topics/x.md' },
        ]);
    });

    it('normalizes keys by whitespace and case', () => {
        expect(normalizeKey('  @Rowboat   Research pricing MODELS ')).toEqual('@rowboat research pricing models');
    });

    it('detects @rowboat mentions as delegation', () => {
        expect(isDelegated('@rowboat do the thing')).toBe(true);
        expect(isDelegated('email arjun@rowboatlabs.com')).toBe(false);
        expect(isDelegated('plain item')).toBe(false);
    });
});
