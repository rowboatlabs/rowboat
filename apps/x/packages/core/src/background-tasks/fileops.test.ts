import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-task-boundary-'));
  vi.resetModules();
  vi.doMock('../config/config.js', () => ({ WorkDir: root }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock('../config/config.js');
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

it('rejects traversal without reading, rewriting, or deleting an outside task', async () => {
  const tasks = await import('./fileops.js');
  const outside = path.join(root, 'private');
  await fs.mkdir(outside);
  const content = 'name: Private\ninstructions: Keep me\nactive: true\ncreatedAt: today\n';
  await fs.writeFile(path.join(outside, 'task.yaml'), content);
  await expect(tasks.fetchTask('../private')).rejects.toThrow('Invalid task slug');
  await expect(tasks.patchTask('../private', { instructions: 'changed' })).rejects.toThrow('Invalid task slug');
  await expect(tasks.deleteTask('../private')).rejects.toThrow('Invalid task slug');
  expect(await fs.readFile(path.join(outside, 'task.yaml'), 'utf8')).toBe(content);
});

it.each(['', '.', '..', '../private', 'nested/task', 'nested\\task', '/absolute', 'bad\0name'])('rejects invalid slug %j in every path helper', async (slug) => {
  const tasks = await import('./fileops.js');
  for (const helper of [tasks.taskYamlPath, tasks.taskIndexPath, tasks.taskRunsLogPath]) {
    expect(() => helper(slug)).toThrow('Invalid task slug');
  }
});

it('keeps generated slugs, collision suffixes, and task operations working', async () => {
  const tasks = await import('./fileops.js');
  const input = { name: 'Daily digest', instructions: 'Summarize updates' };
  const first = await tasks.createTask(input);
  const second = await tasks.createTask(input);
  expect(first.slug).toBe('daily-digest');
  expect(second.slug).toBe('daily-digest-2');
  await tasks.patchTask(second.slug, { active: false });
  expect((await tasks.fetchTask(second.slug))?.active).toBe(false);
  await tasks.prependRunId(first.slug, 'run-1');
  expect(await tasks.readRunIds(first.slug)).toEqual(['run-1']);
  expect((await tasks.listTasks()).total).toBe(2);
  await tasks.deleteTask(second.slug);
  expect(await tasks.fetchTask(second.slug)).toBeNull();
});
