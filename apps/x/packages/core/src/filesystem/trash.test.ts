import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-trash-'));
  vi.resetModules();
  vi.doMock('../config/config.js', () => ({ WorkDir: root }));
  vi.doMock('../knowledge/version_history.js', () => ({ commitAll: vi.fn() }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock('../config/config.js');
  vi.doUnmock('../knowledge/version_history.js');
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

it.each(['workspace', 'filesystem', 'mixed'])('preserves concurrent same-name deletions through %s', async (mode) => {
  const workspace = await import('../workspace/workspace.js');
  const files = await import('./files.js');
  for (const name of ['a', 'b']) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'same.md'), name);
  }
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  const access = fs.access.bind(fs);
  let arrive = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(fs, 'access').mockImplementation(async (file, ...args) => {
    if (String(file).includes(`${path.sep}.trash${path.sep}`)) {
      if (++arrive === 2) release();
      await gate;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }
    return access(file, ...args);
  });
  const first = mode === 'filesystem' ? files.remove : workspace.remove;
  const second = mode === 'workspace' ? workspace.remove : files.remove;
  await Promise.all([first('a/same.md'), second('b/same.md')]);
  const trash = path.join(root, '.trash');
  const contents: string[] = [];
  for (const name of await fs.readdir(trash, { recursive: true })) {
    const target = path.join(trash, name);
    if ((await fs.stat(target)).isFile()) contents.push(await fs.readFile(target, 'utf8'));
  }
  expect(contents.sort()).toEqual(['a', 'b']);
  await expect(fs.access(path.join(root, 'a/same.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.access(path.join(root, 'b/same.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('returns a recoverable path for a directory without changing its contents', async () => {
  const files = await import('./files.js');
  await fs.mkdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(root, 'folder', 'kept.md'), 'kept');
  const result = await files.remove('folder');
  expect(result.trashed).toBeDefined();
  expect(await fs.readFile(path.join(result.trashed!, 'kept.md'), 'utf8')).toBe('kept');
});

it('keeps the source and cleans its reservation when the move fails', async () => {
  const files = await import('./files.js');
  await fs.writeFile(path.join(root, 'kept.md'), 'original');
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'EACCES' }));
  await expect(files.remove('kept.md')).rejects.toMatchObject({ code: 'EACCES' });
  expect(await fs.readFile(path.join(root, 'kept.md'), 'utf8')).toBe('original');
  expect(await fs.readdir(path.join(root, '.trash'))).toEqual([]);
});
