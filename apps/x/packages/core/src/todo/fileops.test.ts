import { describe, expect, it } from 'vitest';
import { todoSections } from '@x/shared/dist/todo.js';
import { applySectionAction, insertTodoItem, isDelegated, normalizeKey, parseArchive, parseTodoFile, serializeTodoFile, subKey } from './fileops.js';

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

    it('parses nested sub-items with scoped keys and their own receipts', () => {
        const md = `- [ ] create pitch deck
  - → outline receipt on the parent
  - [x] @rowboat research TAM
    - → [TAM research](knowledge/Topics/tam.md) — $4.2B, three segments
  - [ ] research competitors
- [ ] send follow-up emails
`;
        const list = parseTodoFile(md);
        const items = list.blocks.filter(b => b.kind === 'item').map(b => b.item);
        expect(items).toHaveLength(2);
        const deck = items[0];
        expect(deck.receipts).toHaveLength(1);
        expect(deck.children.map(c => [c.text, c.checked, c.delegated])).toEqual([
            ['@rowboat research TAM', true, true],
            ['research competitors', false, false],
        ]);
        expect(deck.children[0].key).toEqual(subKey('create pitch deck', '@rowboat research TAM'));
        expect(deck.children[0].receipts[0].links).toEqual([
            { label: 'TAM research', path: 'knowledge/Topics/tam.md' },
        ]);
        // Byte-stable round-trip with nesting.
        expect(serializeTodoFile(list)).toEqual(md);
    });

    it('flattens multi-line receipt text to one line', () => {
        const md = serializeTodoFile({
            blocks: [{
                kind: 'item',
                item: {
                    key: 'x', text: 'x', checked: false, delegated: false, children: [],
                    receipts: [{ kind: 'error', text: 'Incorrect API key [status 401 — {\n  "error": {\n    "message": "boom"\n}]', links: [] }],
                },
            }],
        });
        expect(md).toEqual('- [ ] x\n  - → failed: Incorrect API key [status 401 — { "error": { "message": "boom" }]\n');
        // Round-trips as one item with one receipt — no raw junk lines.
        const back = parseTodoFile(md);
        const items = back.blocks.filter(b => b.kind === 'item');
        expect(items).toHaveLength(1);
        expect(items[0].kind === 'item' && items[0].item.receipts).toHaveLength(1);
        expect(back.blocks.filter(b => b.kind === 'raw' && b.text.trim() !== '')).toHaveLength(0);
    });

    it('parses archive files into dated entries with restore handles', () => {
        const archive = `
## 2026-07-27

- [x] @rowboat research pricing
  - → [notes](knowledge/Topics/pricing.md)

## 2026-07-28

- [ ] call the bank
`;
        const entries = parseArchive('2026-07', archive);
        expect(entries.map(e => [e.item.text, e.date, e.item.checked])).toEqual([
            ['@rowboat research pricing', '2026-07-27', true],
            ['call the bank', '2026-07-28', false],
        ]);
        // blockIndex points at the item inside the parsed file, so a
        // restore can splice it out precisely.
        const blocks = parseTodoFile(archive).blocks;
        for (const e of entries) {
            const b = blocks[e.blockIndex];
            expect(b.kind === 'item' && b.item.key).toEqual(e.item.key);
        }
    });

    it('detects @rowboat mentions as delegation', () => {
        expect(isDelegated('@rowboat do the thing')).toBe(true);
        expect(isDelegated('email arjun@rowboatlabs.com')).toBe(false);
        expect(isDelegated('plain item')).toBe(false);
    });
});

describe('todo sections', () => {
    const sample = () => parseTodoFile('- [ ] inbox\n## Work\n- [ ] parent\n  - [ ] child\n  - → receipt\nA note\n## Personal\n- [x] done\n');
    it('discovers headings without changing archive parsing or raw Markdown', () => {
        const list = sample();
        expect(todoSections(list.blocks).map(s => s.name)).toEqual(['Uncategorized', 'Work', 'Personal']);
        expect(serializeTodoFile(parseTodoFile(serializeTodoFile(list)))).toEqual(serializeTodoFile(list));
        expect(parseArchive('2026-09', '## 2026-09-16\n- [x] archived\n')[0].date).toBe('2026-09-16');
    });
    it('renames the default section durably while keeping default insertion and task identities', () => {
        const list = sample();
        applySectionAction(list, { type: 'rename', section: null, name: 'Inbox' });
        const reloaded = parseTodoFile(serializeTodoFile(list));
        expect(todoSections(reloaded.blocks)[0].name).toBe('Inbox');
        expect(todoSections(reloaded.blocks)[0].ref).toBeNull();
        const block = parseTodoFile('- [ ] new task').blocks[0];
        if (block.kind !== 'item') throw new Error('expected task');
        insertTodoItem(reloaded, block);
        expect(serializeTodoFile(reloaded)).toContain('- [ ] new task\n## Work');
        expect(() => applySectionAction(reloaded, { type: 'create', name: 'Inbox' })).toThrow();
        expect(() => applySectionAction(reloaded, { type: 'rename', section: null, name: 'Work' })).toThrow();
        applySectionAction(reloaded, { type: 'rename', section: null, name: 'Inbox' });
        applySectionAction(reloaded, { type: 'rename', section: null, name: 'Uncategorized' });
        expect(todoSections(reloaded.blocks)[0].name).toBe('Uncategorized');
        expect(serializeTodoFile(reloaded).match(/Default section:/g)).toHaveLength(1);
        expect(reloaded.blocks.find(b => b.kind === 'item')).toMatchObject({ item: { key: 'inbox' } });
    });

    it('creates and renames empty sections, rejects invalid and duplicate names', () => {
        const list = sample();
        applySectionAction(list, { type: 'create', name: 'Ideas' });
        const ref = todoSections(list.blocks).at(-1)!.ref!;
        applySectionAction(list, { type: 'rename', section: ref, name: 'Later' });
        expect(todoSections(list.blocks).at(-1)!.name).toBe('Later');
        for (const name of ['', 'work', 'Uncategorized', 'a\nb']) {
            expect(() => applySectionAction(list, { type: 'create', name })).toThrow();
        }
    });
    it('moves a parent with child receipts and unchanged task keys', () => {
        const list = sample();
        const before = structuredClone(list.blocks.find(b => b.kind === 'item' && b.item.key === 'parent'));
        applySectionAction(list, { type: 'move', key: 'parent', section: todoSections(list.blocks)[2].ref });
        const last = list.blocks.filter(b => b.kind === 'item').at(-1);
        expect(last).toEqual(before);
        expect(serializeTodoFile(list)).toContain('## Personal\n- [x] done\n\n- [ ] parent');
    });
    it('moves both ways and into Uncategorized', () => {
        const list = sample();
        applySectionAction(list, { type: 'move', key: 'done', section: todoSections(list.blocks)[1].ref });
        applySectionAction(list, { type: 'move', key: 'parent', section: null });
        const first = todoSections(list.blocks)[0];
        expect(list.blocks.slice(first.start, first.end).filter(b => b.kind === 'item').map(b => b.kind === 'item' && b.item.key)).toEqual(['inbox', 'parent']);
    });
    it('reorders a whole section including notes and children', () => {
        const list = sample();
        const original = serializeTodoFile(list);
        applySectionAction(list, { type: 'reorder', section: todoSections(list.blocks)[2].ref!, direction: 'up' });
        expect(todoSections(list.blocks).map(s => s.name)).toEqual(['Uncategorized', 'Personal', 'Work']);
        expect(serializeTodoFile(list)).toContain('  - → receipt\nA note');
        applySectionAction(list, { type: 'reorder', section: todoSections(list.blocks)[1].ref!, direction: 'down' });
        expect(serializeTodoFile(list)).toEqual(original);
    });
    it('relocates across multiple sections without losing contents and ignores self drops', () => {
        const list = sample();
        applySectionAction(list, { type: 'create', name: 'Later' });
        const original = structuredClone(list);
        applySectionAction(list, { type: 'relocate', section: todoSections(list.blocks)[1].ref!, before: todoSections(list.blocks)[3].ref! });
        expect(todoSections(list.blocks).map(s => s.name)).toEqual(['Uncategorized', 'Personal', 'Work', 'Later']);
        applySectionAction(list, { type: 'relocate', section: todoSections(list.blocks)[2].ref!, before: todoSections(list.blocks)[1].ref! });
        expect(list).toEqual(original);
        const section = todoSections(list.blocks)[1].ref!;
        applySectionAction(list, { type: 'relocate', section, before: section });
        expect(list).toEqual(original);
    });
    it('removes only the heading, preserving tasks and notes in Uncategorized', () => {
        const list = sample();
        applySectionAction(list, { type: 'remove', section: todoSections(list.blocks)[1].ref! });
        expect(todoSections(list.blocks).map(s => s.name)).toEqual(['Uncategorized', 'Personal']);
        expect(serializeTodoFile(list)).toContain('  - → receipt\nA note\n## Personal');
    });
    it('defaults new and restored top-level items to Uncategorized', () => {
        const list = sample();
        const block = parseTodoFile('- [ ] new task').blocks[0];
        if (block.kind !== 'item') throw new Error('expected item');
        insertTodoItem(list, block);
        expect(serializeTodoFile(list)).toContain('- [ ] inbox\n- [ ] new task\n## Work');
        insertTodoItem(list, { ...block, item: { ...block.item, key: 'selected', text: 'selected' } }, todoSections(list.blocks)[1].ref);
        expect(serializeTodoFile(list)).toContain('A note\n- [ ] selected\n## Personal');
    });
    it('rejects stale references and ambiguous task identities without mutating', () => {
        const list = sample();
        const ref = todoSections(list.blocks)[2].ref!;
        applySectionAction(list, { type: 'remove', section: todoSections(list.blocks)[1].ref! });
        const before = serializeTodoFile(list);
        expect(() => applySectionAction(list, { type: 'rename', section: ref, name: 'Oops' })).toThrow('Section changed');
        expect(serializeTodoFile(list)).toBe(before);
        const duplicates = parseTodoFile('- [ ] same\n## Work\n- [ ] same\n');
        expect(() => applySectionAction(duplicates, { type: 'move', key: 'same', section: null })).toThrow('ambiguous');
    });
    it('addresses manually duplicated headings separately', () => {
        const list = parseTodoFile('## Work\n- [ ] one\n## Work\n- [ ] two\n');
        applySectionAction(list, { type: 'rename', section: todoSections(list.blocks)[2].ref!, name: 'Other' });
        expect(todoSections(list.blocks).map(s => s.name)).toEqual(['Uncategorized', 'Work', 'Other']);
    });
});
