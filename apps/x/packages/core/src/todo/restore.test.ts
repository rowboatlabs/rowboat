import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root: string;
let archive: string;
const archived = '## 2026-11-01\n\n- [x] Recover this\n  - → receipt to keep\n';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-todo-restore-'));
  archive = path.join(root, 'todo/archive/2026-11.md');
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, archived);
  await fs.writeFile(path.join(root, 'todo.md'), '- [ ] Existing\n');
  vi.resetModules();
  vi.doMock('../config/config.js', () => ({ WorkDir: root }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock('../config/config.js');
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

async function entry() {
  const todos = await import('./fileops.js');
  return { todos, item: todos.parseArchive('2026-11', archived)[0] };
}

it('keeps the archived item and receipts when the active-list write fails', async () => {
  const { todos, item } = await entry();
  const write = fs.writeFile.bind(fs);
  vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
    if (String(file) === path.join(root, 'todo.md')) throw new Error('simulated active-list write failure');
    return write(file, data, options);
  });
  await expect(todos.restoreItem(item.month, item.blockIndex, item.item.key)).rejects.toThrow('active-list write failure');
  expect(await fs.readFile(archive, 'utf8')).toBe(archived);
  expect(await fs.readFile(path.join(root, 'todo.md'), 'utf8')).toBe('- [ ] Existing\n');
});

it('keeps a restored active copy if removing the archive entry fails', async () => {
  const { todos, item } = await entry();
  const write = fs.writeFile.bind(fs);
  vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
    if (String(file) === archive) throw new Error('simulated archive write failure');
    return write(file, data, options);
  });
  await expect(todos.restoreItem(item.month, item.blockIndex, item.item.key)).rejects.toThrow('archive write failure');
  const active = await fs.readFile(path.join(root, 'todo.md'), 'utf8');
  expect(active).toContain('- [ ] Recover this');
  expect(active).toContain('receipt to keep');
  expect(active).toContain('Existing');
  expect(await fs.readFile(archive, 'utf8')).toBe(archived);
});

it('restores an unchecked item with receipts and removes its archived copy', async () => {
  const { todos, item } = await entry();
  await expect(todos.restoreItem(item.month, item.blockIndex, item.item.key)).resolves.toBe(true);
  expect(todos.parseArchive(item.month, await fs.readFile(archive, 'utf8'))).toEqual([]);
  const active = await fs.readFile(path.join(root, 'todo.md'), 'utf8');
  expect(active).toContain('- [ ] Recover this');
  expect(active).toContain('receipt to keep');
});

it('refuses a stale restore handle without modifying either file', async () => {
  const { todos, item } = await entry();
  await expect(todos.restoreItem(item.month, item.blockIndex, 'different item')).resolves.toBe(false);
  expect(await fs.readFile(archive, 'utf8')).toBe(archived);
  expect(await fs.readFile(path.join(root, 'todo.md'), 'utf8')).toBe('- [ ] Existing\n');
});
