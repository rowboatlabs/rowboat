import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchSkillsForUrl } from './matcher.js';

let workDir: string;
let requests: string[];
const skillPath = 'agent-workspace/domain-skills/github/repo-actions.md';
const markdown = '# GitHub repo actions\n\nRead the page before acting.\n';

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-browser-skills-test-'));
  requests = [];
  vi.resetModules();
  vi.doMock('../../config/config.js', () => ({ WorkDir: workDir }));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/branches/main')) {
      return Response.json({ commit: { commit: { tree: { sha: 'tree-sha' } } } });
    }
    if (url.endsWith('/git/trees/tree-sha?recursive=1')) {
      return Response.json({ truncated: false, tree: [
        { type: 'blob', path: skillPath, sha: 'skill-sha' },
        { type: 'tree', path: 'agent-workspace/domain-skills/github', sha: 'dir-sha' },
        { type: 'blob', path: 'agent-workspace/domain-skills/github/image.png', sha: 'image-sha' },
        { type: 'blob', path: 'README.md', sha: 'readme-sha' },
      ] });
    }
    if (url === `https://raw.githubusercontent.com/browser-use/browser-harness/main/${skillPath}`) {
      return new Response(markdown);
    }
    throw new Error(`Unexpected network request: ${url}`);
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.doUnmock('../../config/config.js');
  vi.resetModules();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('Browser Harness skill source', () => {
  it('loads canonical domain skills, preserving IDs, local paths and URL suggestions', async () => {
    const { ensureLoaded, readSkillContent } = await import('./loader.js');
    const status = await ensureLoaded();
    expect(status.status).toBe('ready');
    if (status.status !== 'ready') throw new Error('Expected a ready skill index');
    expect(status.index.entries).toEqual([{
      id: 'github/repo-actions', site: 'github', fileName: 'repo-actions.md',
      title: 'GitHub repo actions', path: skillPath,
      localPath: path.join(workDir, 'cache', 'browser-skills', 'domain-skills', 'github', 'repo-actions.md'),
    }]);
    expect(matchSkillsForUrl(status.index, 'https://github.com/rowboatlabs/rowboat')
      .map(entry => entry.id)).toEqual(['github/repo-actions']);
    expect(await readSkillContent('github/repo-actions')).toMatchObject({ ok: true, content: markdown });
    const disk = JSON.parse(await fs.readFile(path.join(workDir, 'cache', 'browser-skills', 'manifest.json'), 'utf8'));
    expect(disk.entries).toEqual(status.index.entries);
    expect(requests).toHaveLength(3);
  });

  it('keeps the existing fresh-cache behavior without another network request', async () => {
    const { refreshFromRemote, ensureLoaded } = await import('./loader.js');
    const index = await refreshFromRemote();
    requests.length = 0;
    expect(await ensureLoaded()).toEqual({ status: 'ready', index });
    expect(requests).toEqual([]);
  });

  it('still reports GitHub failures without writing a successful empty cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
    const { ensureLoaded } = await import('./loader.js');
    expect(await ensureLoaded()).toMatchObject({ status: 'error', error: expect.stringContaining('503') });
    await expect(fs.stat(path.join(workDir, 'cache', 'browser-skills', 'manifest.json'))).rejects.toThrow();
  });
});
