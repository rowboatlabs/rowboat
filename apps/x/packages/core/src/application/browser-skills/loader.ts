import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { WorkDir } from '../../config/config.js';

const REPO_OWNER = 'browser-use';
const REPO_NAME = 'browser-harness';
const REPO_BRANCH = 'main';
const DOMAIN_SKILLS_PREFIX = 'domain-skills/';

const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

export type SkillEntry = {
  id: string;              // e.g. "github/repo-actions"
  site: string;            // e.g. "github"
  fileName: string;        // e.g. "repo-actions.md"
  title: string;           // first H1 from the markdown, or a derived title
  path: string;            // relative repo path, e.g. "domain-skills/github/repo-actions.md"
  localPath: string;       // absolute path on disk
};

export type SkillsIndex = {
  fetchedAt: number;
  treeSha: string;
  entries: SkillEntry[];
};

export type LoaderStatus =
  | { status: 'ready'; index: SkillsIndex }
  | { status: 'stale'; index: SkillsIndex; refreshing: boolean }
  | { status: 'empty' }
  | { status: 'error'; error: string };

const cacheRoot = () => path.join(WorkDir, 'cache', 'browser-skills');
const skillsDir = () => path.join(cacheRoot(), 'domain-skills');
const manifestPath = () => path.join(cacheRoot(), 'manifest.json');

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(skillsDir(), { recursive: true });
}

async function readManifest(): Promise<SkillsIndex | null> {
  try {
    const raw = await fs.readFile(manifestPath(), 'utf8');
    const parsed = JSON.parse(raw) as SkillsIndex;
    if (!parsed.entries || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeManifest(index: SkillsIndex): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(manifestPath(), JSON.stringify(index, null, 2), 'utf8');
}

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  if (match?.[1]) return match[1].trim();
  return fallback;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'rowboat-browser-skills',
        Accept: 'application/vnd.github+json',
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

type GithubTreeNode = { path: string; type: string; sha: string };

async function fetchRepoTree(): Promise<{ treeSha: string; skillPaths: string[] }> {
  const branchUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/branches/${REPO_BRANCH}`;
  const branchRes = await fetchWithTimeout(branchUrl);
  if (!branchRes.ok) {
    throw new Error(`GitHub branch fetch failed: ${branchRes.status} ${branchRes.statusText}`);
  }
  const branch = (await branchRes.json()) as { commit: { commit: { tree: { sha: string } } } };
  const treeSha = branch.commit?.commit?.tree?.sha;
  if (!treeSha) throw new Error('Could not resolve tree SHA from branch response.');

  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${treeSha}?recursive=1`;
  const treeRes = await fetchWithTimeout(treeUrl);
  if (!treeRes.ok) {
    throw new Error(`GitHub tree fetch failed: ${treeRes.status} ${treeRes.statusText}`);
  }
  const tree = (await treeRes.json()) as { tree: GithubTreeNode[]; truncated: boolean };

  const skillPaths = tree.tree
    .filter((n) => n.type === 'blob' && n.path.startsWith(DOMAIN_SKILLS_PREFIX) && n.path.endsWith('.md'))
    .map((n) => n.path);

  return { treeSha, skillPaths };
}

async function fetchRawFile(repoPath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${repoPath}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'text/plain' } });
  if (!res.ok) {
    throw new Error(`Raw file fetch failed for ${repoPath}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parseRepoPath(repoPath: string): { id: string; site: string; fileName: string } | null {
  const rel = repoPath.slice(DOMAIN_SKILLS_PREFIX.length);
  const parts = rel.split('/');
  if (parts.length < 2) return null;
  const site = parts[0];
  const fileName = parts.slice(1).join('/');
  const id = rel.replace(/\.md$/, '');
  return { id, site, fileName };
}

export async function refreshFromRemote(): Promise<SkillsIndex> {
  await ensureCacheDir();
  const { treeSha, skillPaths } = await fetchRepoTree();

  const entries: SkillEntry[] = [];
  await Promise.all(skillPaths.map(async (repoPath) => {
    const parsed = parseRepoPath(repoPath);
    if (!parsed) return;
    try {
      const content = await fetchRawFile(repoPath);
      const localRel = path.join(parsed.site, parsed.fileName);
      const localPath = path.join(skillsDir(), localRel);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, content, 'utf8');
      entries.push({
        id: parsed.id,
        site: parsed.site,
        fileName: parsed.fileName,
        title: extractTitle(content, parsed.id),
        path: repoPath,
        localPath,
      });
    } catch (err) {
      console.warn(`[browser-skills] Failed to fetch ${repoPath}:`, err);
    }
  }));

  entries.sort((a, b) => a.id.localeCompare(b.id));

  const index: SkillsIndex = {
    fetchedAt: Date.now(),
    treeSha,
    entries,
  };
  await writeManifest(index);
  return index;
}

let inFlightRefresh: Promise<SkillsIndex> | null = null;

export async function ensureLoaded(options?: { forceRefresh?: boolean }): Promise<LoaderStatus> {
  try {
    const existing = await readManifest();
    const fresh = existing && Date.now() - existing.fetchedAt < MANIFEST_TTL_MS;

    if (existing && fresh && !options?.forceRefresh) {
      return { status: 'ready', index: existing };
    }

    if (existing && !options?.forceRefresh) {
      if (!inFlightRefresh) {
        inFlightRefresh = refreshFromRemote()
          .catch((err) => {
            console.warn('[browser-skills] Background refresh failed:', err);
            return existing;
          })
          .finally(() => { inFlightRefresh = null; });
      }
      return { status: 'stale', index: existing, refreshing: true };
    }

    if (!inFlightRefresh) {
      inFlightRefresh = refreshFromRemote().finally(() => { inFlightRefresh = null; });
    }
    try {
      const index = await inFlightRefresh;
      return { status: 'ready', index };
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : 'Failed to load skills.' };
    }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Skill loader failed.' };
  }
}

export async function readSkillContent(id: string): Promise<{ ok: true; content: string; entry: SkillEntry } | { ok: false; error: string }> {
  const status = await ensureLoaded();
  if (status.status === 'error' || status.status === 'empty') {
    return { ok: false, error: status.status === 'error' ? status.error : 'No skills cached yet.' };
  }
  const entry = status.index.entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: `Skill '${id}' not found.` };
  try {
    const content = await fs.readFile(entry.localPath, 'utf8');
    return { ok: true, content, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to read skill file.' };
  }
}
