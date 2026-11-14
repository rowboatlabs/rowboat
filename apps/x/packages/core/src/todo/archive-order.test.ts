import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-archive-order-'));
  await fs.mkdir(path.join(root, 'todo/archive'), { recursive: true });
  vi.resetModules();
  vi.doMock('../config/config.js', () => ({ WorkDir: root }));
});
afterEach(async () => {
  vi.doUnmock('../config/config.js');
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

it.each([
  { now: new Date(2026, 10, 13), current: '2026-11', previous: '2026-10' },
  { now: new Date(2026, 0, 13), current: '2026-01', previous: '2025-12' },
])('lists current month before previous month, including January ($current)', async ({ now, current, previous }) => {
  const todos = await import('./fileops.js');
  const currentText = '- [x] current older\n- [x] current newer\n';
  const previousText = '- [x] previous older\n- [x] previous newer\n';
  await fs.writeFile(path.join(root, 'todo/archive', `${current}.md`), currentText);
  await fs.writeFile(path.join(root, 'todo/archive', `${previous}.md`), previousText);
  const result = await todos.listArchived(30, now);
  expect(result.map(entry => entry.item.text)).toEqual(['current newer', 'current older', 'previous newer', 'previous older']);
  expect((await todos.listArchived(2, now)).map(entry => entry.item.text)).toEqual(['current newer', 'current older']);
  for (const entry of result) {
    const original = todos.parseTodoFile(entry.month === current ? currentText : previousText).blocks[entry.blockIndex];
    expect(original).toMatchObject({ kind: 'item', item: { key: entry.item.key } });
  }
});

it.each(['2026-11', '2026-10'])('keeps newest-first order when only %s exists', async (month) => {
  const todos = await import('./fileops.js');
  await fs.writeFile(path.join(root, 'todo/archive', `${month}.md`), '- [x] older\n- [x] newer\n');
  expect((await todos.listArchived(30, new Date(2026, 10, 13))).map(entry => entry.item.text)).toEqual(['newer', 'older']);
});
