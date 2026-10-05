import { describe, expect, it } from 'vitest';
import { createToInstance, freeName, LIMITS, planFolder, safeName, TooBigError, type ToInstanceDeps } from '../src/to-instance.js';

// Files and folders of the computer, copied to the instance (05/10/2026).

type Node = { file: number } | { link: true } | { dir: Record<string, Node> };

function setup(tree: Record<string, Node>, opts: { remote?: boolean; existing?: string[] } = {}) {
  const written = new Map<string, string>();
  const existing = new Set(opts.existing ?? []);
  const find = (abs: string): Node | undefined => {
    let node: Node | undefined = { dir: tree };
    for (const part of abs.split('/').filter(Boolean)) {
      node = node && 'dir' in node ? node.dir[part] : undefined;
    }
    return node;
  };
  const kindOf = (n: Node | undefined) => (!n ? 'other' : 'dir' in n ? 'dir' : 'file' in n ? 'file' : 'other') as 'file' | 'dir' | 'other';
  const deps: ToInstanceDeps = {
    remote: () => opts.remote ?? true,
    stat: async (abs) => {
      const n = find(abs);
      if (!n) throw new Error(`ENOENT ${abs}`);
      return { kind: kindOf(n), size: 'file' in n ? n.file : 0 };
    },
    readdir: async (abs) => {
      const n = find(abs);
      if (!n || !('dir' in n)) throw new Error(`ENOTDIR ${abs}`);
      return Object.entries(n.dir).map(([name, child]) => ({ name, kind: kindOf(child) }));
    },
    readFile: async (abs) => `b64:${abs}`,
    exists: async (rel) => existing.has(rel) || written.has(rel) || [...written.keys()].some((k) => k.startsWith(`${rel}/`)),
    write: async (rel, data) => void written.set(rel, data),
    root: async () => '/data/.rowboat/',
    now: () => Date.UTC(2026, 9, 5, 12),
    parallel: 2,
  };
  return { deps, written, send: createToInstance(deps) };
}

describe('safeName', () => {
  it('keeps a plain name and cleans what the workspace refuses', () => {
    expect(safeName('Devis 2026.pdf')).toBe('Devis 2026.pdf');
    expect(safeName('a..b.txt')).toBe('a.b.txt');
    expect(safeName('..')).toBe('file');
    expect(safeName('a/b')).toBe('a-b');
  });
});

describe('freeName', () => {
  it('numbers a taken name, before the extension of a file', async () => {
    const taken = new Set(['A/photo.png', 'A/photo 2.png', 'A/site']);
    const exists = async (rel: string) => taken.has(rel);
    expect(await freeName('A', 'photo.png', true, exists)).toBe('photo 3.png');
    expect(await freeName('A', 'site', false, exists)).toBe('site 2');
    expect(await freeName('A', 'new.md', true, exists)).toBe('new.md');
  });
});

describe('planFolder', () => {
  it('leaves out rebuilt folders, links and big files, keeps git', async () => {
    const { deps } = setup({
      site: { dir: {
        'index.html': { file: 10 },
        '.git': { dir: { HEAD: { file: 1 } } },
        node_modules: { dir: { x: { file: 5 } } },
        '.DS_Store': { file: 1 },
        secret: { link: true },
        'video.mov': { file: LIMITS.fileBytes + 1 },
        src: { dir: { 'app.ts': { file: 3 } } },
      } },
    });
    const plan = await planFolder('/site', deps);
    expect(plan.files.map((f) => f.rel).sort()).toEqual(['.git/HEAD', 'index.html', 'src/app.ts']);
    expect(plan.skipped).toEqual(['/site/video.mov']);
  });

  it('refuses a folder over the limits', async () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.files + 1 }, (_, i) => [`f${i}`, { file: 1 }]));
    const { deps } = setup({ big: { dir: many } });
    await expect(planFolder('/big', deps)).rejects.toBeInstanceOf(TooBigError);
  });
});

describe('createToInstance', () => {
  it('keeps the paths when the app runs its own core', async () => {
    const { send, written } = setup({ a: { file: 1 } }, { remote: false });
    expect(await send({ paths: ['/a'], into: 'attachments' })).toEqual({ paths: ['/a'], skipped: [] });
    expect(written.size).toBe(0);
  });

  it('copies a folder into Projects, under a free name', async () => {
    const { send, written } = setup(
      { Users: { dir: { awa: { dir: { boutique: { dir: { 'a.txt': { file: 1 }, sub: { dir: { 'b.txt': { file: 1 } } } } } } } } } },
      { existing: ['Projects/boutique'] },
    );
    const result = await send({ paths: ['/Users/awa/boutique'], into: 'projects' });
    expect(result).toEqual({ paths: ['/data/.rowboat/Projects/boutique 2'], skipped: [] });
    expect([...written.keys()].sort()).toEqual(['Projects/boutique 2/a.txt', 'Projects/boutique 2/sub/b.txt']);
    expect(written.get('Projects/boutique 2/a.txt')).toBe('b64:/Users/awa/boutique/a.txt');
  });

  it('keeps an empty folder', async () => {
    const { send, written } = setup({ vide: { dir: {} } });
    await send({ paths: ['/vide'], into: 'projects' });
    expect([...written.keys()]).toEqual(['Projects/vide/.keep']);
  });

  it('copies attached files under the day, side by side', async () => {
    const { send } = setup({ docs: { dir: { 'devis.pdf': { file: 1 }, autre: { dir: { 'devis.pdf': { file: 1 } } } } } });
    const result = await send({ paths: ['/docs/devis.pdf', '/docs/autre/devis.pdf'], into: 'attachments' });
    expect(result.paths).toEqual([
      '/data/.rowboat/Attachments/2026-10-05/devis.pdf',
      '/data/.rowboat/Attachments/2026-10-05/devis 2.pdf',
    ]);
  });

  it('sends nothing of a folder that is too big', async () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.files + 1 }, (_, i) => [`f${i}`, { file: 1 }]));
    const { send, written } = setup({ big: { dir: many } });
    await expect(send({ paths: ['/big'], into: 'projects' })).rejects.toBeInstanceOf(TooBigError);
    expect(written.size).toBe(0);
  });

  it('refuses a file over the limit', async () => {
    const { send } = setup({ 'film.mov': { file: LIMITS.fileBytes + 1 } });
    await expect(send({ paths: ['/film.mov'], into: 'attachments' })).rejects.toBeInstanceOf(TooBigError);
  });
});
