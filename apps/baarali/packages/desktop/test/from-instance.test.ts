import { describe, expect, it } from 'vitest';
import { createFromInstance, mimeOf, type FromInstanceDeps } from '../src/from-instance.js';

// What the agent makes on the instance, shown on the computer (05/10/2026).

function setup(opts: { remote?: boolean; here?: string[]; size?: number } = {}) {
  const asked: string[] = [];
  const deps: FromInstanceDeps = {
    remote: () => opts.remote ?? true,
    existsHere: async (abs) => (opts.here ?? []).includes(abs),
    root: async () => '/data/workdir/',
    read: async (rel) => {
      asked.push(rel);
      return { data: 'aW1n', size: opts.size ?? 3 };
    },
  };
  return { read: createFromInstance(deps), asked };
}

describe('a file of the instance, read from the computer', () => {
  it('reads an image the agent generated in the instance workspace', async () => {
    const { read, asked } = setup();
    expect(await read('/data/workdir/generated_images/lion-1.png')).toEqual({ data: 'aW1n', mimeType: 'image/png', size: 3 });
    expect(asked).toEqual(['generated_images/lion-1.png']);
  });

  it('leaves to the computer a file that is here, outside the workspace, or any file in local mode', async () => {
    expect(await setup({ here: ['/data/workdir/a.png'] }).read('/data/workdir/a.png')).toBeNull();
    expect(await setup().read('/Users/me/Pictures/a.png')).toBeNull();
    expect(await setup().read('/data/workdir-other/a.png')).toBeNull();
    expect(await setup({ remote: false }).read('/data/workdir/a.png')).toBeNull();
    expect(await setup().read('~/a.png')).toBeNull();
  });

  it('never climbs out of the workspace, and keeps the 10 MB ceiling', async () => {
    const { read, asked } = setup();
    expect(await read('/data/workdir/../etc/passwd')).toBeNull();
    expect(asked).toEqual([]);
    await expect(setup({ size: 11 * 1024 * 1024 }).read('/data/workdir/big.png')).rejects.toThrow('File too large');
  });

  it('names the type from the extension', () => {
    expect(mimeOf('a.JPG')).toBe('image/jpeg');
    expect(mimeOf('voice.mp3')).toBe('audio/mpeg');
    expect(mimeOf('noext')).toBe('application/octet-stream');
  });
});
