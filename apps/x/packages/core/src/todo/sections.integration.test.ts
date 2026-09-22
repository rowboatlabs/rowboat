import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { todoSections } from '@x/shared/dist/todo.js';
const { directory } = vi.hoisted(() => ({ directory: `/tmp/rowboat-todo-sections-${process.pid}-${Date.now()}` }));
vi.mock('../config/config.js', () => ({ WorkDir: directory }));
import { addItem, attachReceipt, changeTodoSection, clearCompleted, listArchived, readTodo, restoreItem } from './fileops.js';
beforeEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(`${directory}/todo.md`, '- [ ] inbox\n## Work\n- [ ] @rowboat research\n  - [ ] child\n## Personal\n');
});
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe('section operations on disk', () => {
    it.each([true, false])('retains concurrent completion receipts, move first=%s', async moveFirst => {
        const list = await readTodo();
        const move = () => changeTodoSection({ type: 'move', key: '@rowboat research', section: todoSections(list.blocks)[2].ref });
        const complete = () => attachReceipt('@rowboat research', { kind: 'result', text: 'Research finished', links: [] }, { check: true });
        await Promise.all(moveFirst ? [move(), complete()] : [complete(), move()]);
        const result = await readTodo();
        const section = todoSections(result.blocks)[2];
        const block = result.blocks.slice(section.start, section.end).find(b => b.kind === 'item');
        expect(block?.kind === 'item' && block.item.key).toBe('@rowboat research');
        expect(block?.kind === 'item' && block.item.checked).toBe(true);
        expect(block?.kind === 'item' && block.item.children[0].checked).toBe(true);
        expect(block?.kind === 'item' && block.item.receipts[0].text).toBe('Research finished');
    });
    it('inserts accepted suggestions into Uncategorized and restores there after archiving', async () => {
        await addItem('suggestion', { proposed: true });
        let list = await readTodo();
        const uncategorized = todoSections(list.blocks)[0];
        expect(list.blocks.slice(0, uncategorized.end).some(b => b.kind === 'item' && b.item.proposed)).toBe(true);
        await attachReceipt('@rowboat research', { kind: 'result', text: 'Done', links: [] }, { check: true });
        await clearCompleted();
        expect(todoSections((await readTodo()).blocks).map(s => s.name)).toEqual(['Uncategorized', 'Work', 'Personal']);
        const [archived] = await listArchived();
        expect(await restoreItem(archived.month, archived.blockIndex, archived.item.key)).toBe(true);
        list = await readTodo();
        expect(list.blocks.slice(0, todoSections(list.blocks)[0].end).some(b => b.kind === 'item' && b.item.key === '@rowboat research')).toBe(true);
    });
    it('keeps new and restored tasks in the renamed default section after rereading disk', async () => {
        await changeTodoSection({ type: 'rename', section: null, name: 'Inbox' });
        await addItem('new default task');
        await attachReceipt('inbox', { kind: 'result', text: 'Done', links: [] }, { check: true });
        await clearCompleted();
        const [archived] = await listArchived();
        await restoreItem(archived.month, archived.blockIndex, archived.item.key);
        const list = await readTodo();
        const section = todoSections(list.blocks)[0];
        expect(section.name).toBe('Inbox');
        expect(list.blocks.slice(0, section.end).filter(b => b.kind === 'item').map(b => b.kind === 'item' && b.item.key)).toEqual(['new default task', 'inbox']);
    });

    it('relocates a whole section to the bottom and back before another section', async () => {
        const original = await readTodo();
        await changeTodoSection({ type: 'relocate', section: todoSections(original.blocks)[1].ref!, before: null });
        let list = await readTodo();
        expect(todoSections(list.blocks).map(s => s.name)).toEqual(['Uncategorized', 'Personal', 'Work']);
        const work = todoSections(list.blocks)[2];
        const task = list.blocks[work.start];
        expect(task.kind === 'item' && task.item.children[0].text).toBe('child');
        await changeTodoSection({ type: 'relocate', section: work.ref!, before: todoSections(list.blocks)[1].ref! });
        list = await readTodo();
        // The Markdown writer ensures a trailing newline after each disk write.
        const content = (value: typeof list) => value.blocks.filter(b => b.kind !== 'raw' || b.text.trim());
        expect(content(list)).toEqual(content(original));
    });
    it('rejects stale drop targets without removing the source section', async () => {
        const original = await readTodo();
        await expect(changeTodoSection({ type: 'relocate', section: todoSections(original.blocks)[1].ref!, before: { index: 99, heading: '## Missing' } })).rejects.toThrow('Section changed');
        expect(await readTodo()).toEqual(original);
    });
    it('rejects stale add destinations without writing a task', async () => {
        const ref = todoSections((await readTodo()).blocks)[1].ref!;
        await changeTodoSection({ type: 'rename', section: ref, name: 'Projects' });
        await expect(addItem('lost task', { section: ref })).rejects.toThrow('Section changed');
        expect(await fs.readFile(`${directory}/todo.md`, 'utf8')).not.toContain('lost task');
    });
});
