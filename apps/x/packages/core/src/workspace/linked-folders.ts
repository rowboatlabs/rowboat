import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { workspace } from '@x/shared';
import { WorkDir } from '../config/config.js';

// ============================================================================
// Linked Folder Registry
// ============================================================================
//
// A workspace normally lives under `$WorkDir/knowledge/Workspace`. A *linked*
// workspace is any folder elsewhere on disk that the user has pointed Rowboat
// at. The folder is never copied or symlinked — the registry just records
// where it is, and the workspace path space gains a second kind of root:
//
//     @folder/<id>/<sub/path>
//
// `resolveWorkspacePath` maps that to the real location and containment-checks
// against the linked root (instead of WorkDir), so every existing workspace:*
// operation — readdir, read, write, rename, delete, reveal-in-Finder — works
// on a linked folder with no other changes.
//
// Deliberately NOT wired up: the knowledge index, the knowledge graph, wiki
// links, and version history all scan `knowledge/` under WorkDir, so linked
// folders stay out of them by construction. The workspace watcher does not
// watch linked roots either (a folder with node_modules would exhaust the
// process fd limit — see workspace/watcher.ts); the UI refreshes on navigation
// and after its own mutations instead.

export type LinkedFolder = z.infer<typeof workspace.LinkedFolder>;

const PREFIX = workspace.LINKED_FOLDER_PREFIX;

const RegistryFile = z.object({
  version: z.literal(1),
  folders: z.array(workspace.LinkedFolder),
});

function registryPath(): string {
  return path.join(WorkDir, 'config', 'workspace-folders.json');
}

// The registry is read on every path resolution, so keep an in-memory copy and
// only re-parse when the file's mtime/size changes (it is also hand-editable).
let cache: { folders: LinkedFolder[]; mtimeMs: number; size: number } | null = null;

function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function readRegistrySync(): LinkedFolder[] {
  const file = registryPath();
  let stats: fs.Stats;
  try {
    stats = fs.statSync(file);
  } catch {
    cache = null;
    return [];
  }
  if (cache && cache.mtimeMs === stats.mtimeMs && cache.size === stats.size) {
    return cache.folders;
  }
  let folders: LinkedFolder[] = [];
  try {
    const parsed = RegistryFile.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (parsed.success) {
      folders = parsed.data.folders.filter((f) => isValidId(f.id) && path.isAbsolute(f.path));
    } else {
      console.error('[workspace] Ignoring malformed workspace-folders.json');
    }
  } catch (error) {
    console.error('[workspace] Failed to read workspace-folders.json:', error);
  }
  cache = { folders, mtimeMs: stats.mtimeMs, size: stats.size };
  return folders;
}

async function writeRegistry(folders: LinkedFolder[]): Promise<void> {
  const file = registryPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const body: z.infer<typeof RegistryFile> = { version: 1, folders };
  await fsp.writeFile(file, JSON.stringify(body, null, 2), 'utf8');
  cache = null;
}

/** All registered linked folders, in the order they were added. */
export function listLinkedFolders(): LinkedFolder[] {
  return readRegistrySync();
}

export function getLinkedFolder(id: string): LinkedFolder | null {
  return readRegistrySync().find((f) => f.id === id) ?? null;
}

/** True for any path addressed against a linked folder (`@folder/<id>/…`). */
export function isLinkedPath(relPath: string): boolean {
  return relPath === PREFIX || relPath.startsWith(`${PREFIX}/`);
}

/** The workspace path of a linked folder's root. */
export function linkedRootPath(id: string): string {
  return `${PREFIX}/${id}`;
}

/**
 * Split a linked workspace path into its folder id and the remaining
 * folder-relative POSIX path (empty string for the folder root).
 */
export function parseLinkedPath(relPath: string): { id: string; sub: string } | null {
  if (!isLinkedPath(relPath)) return null;
  const rest = relPath.slice(PREFIX.length).replace(/^\/+/, '');
  if (!rest) return null;
  const slash = rest.indexOf('/');
  const id = slash === -1 ? rest : rest.slice(0, slash);
  const sub = slash === -1 ? '' : rest.slice(slash + 1);
  if (!isValidId(id)) return null;
  return { id, sub };
}

/**
 * Resolve a linked workspace path to an absolute path, kept inside the linked
 * folder's own boundary. Returns null if the path isn't a linked path.
 * Throws if it names an unknown folder or escapes that folder.
 */
export function resolveLinkedPath(relPath: string): string | null {
  const parsed = parseLinkedPath(relPath);
  if (!parsed) {
    if (isLinkedPath(relPath)) throw new Error('Invalid linked folder path');
    return null;
  }
  const folder = getLinkedFolder(parsed.id);
  if (!folder) {
    throw new Error('This folder is no longer linked to Rowboat');
  }
  const root = path.resolve(folder.path);
  if (!parsed.sub) return root;
  if (path.isAbsolute(parsed.sub) || parsed.sub.split('/').includes('..')) {
    throw new Error('Path traversal (..) is not allowed');
  }
  const resolved = path.resolve(root, parsed.sub);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Path outside folder boundary');
  }
  return resolved;
}

/**
 * Map an absolute path back into the linked path space, if it sits inside a
 * linked folder. Longest root wins, so nested links resolve to the closest one.
 */
export function absToLinkedPath(absPath: string): string | null {
  const normalized = path.resolve(absPath);
  let best: { folder: LinkedFolder; root: string } | null = null;
  for (const folder of readRegistrySync()) {
    const root = path.resolve(folder.path);
    if (normalized !== root && !normalized.startsWith(root + path.sep)) continue;
    if (!best || root.length > best.root.length) best = { folder, root };
  }
  if (!best) return null;
  const rel = path.relative(best.root, normalized).split(path.sep).join('/');
  return rel ? `${linkedRootPath(best.folder.id)}/${rel}` : linkedRootPath(best.folder.id);
}

/**
 * Register a folder as a workspace. The folder itself is untouched — nothing
 * is copied, moved, or written inside it.
 */
export async function addLinkedFolder(absPath: string, name?: string): Promise<LinkedFolder> {
  if (!absPath || !path.isAbsolute(absPath)) {
    throw new Error('Choose a folder to add');
  }
  const resolved = path.resolve(absPath);

  const stats = await fsp.stat(resolved).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error('That path is not a folder');
  }

  // A folder inside WorkDir is already reachable as a normal workspace path;
  // linking it too would give the same files two identities.
  const workRoot = path.resolve(WorkDir);
  if (resolved === workRoot || resolved.startsWith(workRoot + path.sep)) {
    throw new Error('That folder is already inside your Rowboat workspace');
  }

  const folders = readRegistrySync();
  const existing = folders.find((f) => path.resolve(f.path) === resolved);
  if (existing) {
    throw new Error(`"${existing.name}" already points at that folder`);
  }

  const trimmed = name?.trim();
  const folder: LinkedFolder = {
    id: crypto.randomBytes(6).toString('hex'),
    name: trimmed || path.basename(resolved) || resolved,
    path: resolved,
    addedAt: new Date().toISOString(),
  };
  await writeRegistry([...folders, folder]);
  return folder;
}

/** Unregister a folder. Never touches the files on disk. */
export async function removeLinkedFolder(id: string): Promise<{ ok: true }> {
  const folders = readRegistrySync();
  const next = folders.filter((f) => f.id !== id);
  if (next.length !== folders.length) {
    await writeRegistry(next);
  }
  return { ok: true as const };
}

/** Rename the workspace label. The folder on disk keeps its own name. */
export async function renameLinkedFolder(id: string, name: string): Promise<LinkedFolder> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required');
  if (trimmed.includes('/')) throw new Error('Name cannot contain "/"');
  const folders = readRegistrySync();
  const folder = folders.find((f) => f.id === id);
  if (!folder) throw new Error('This folder is no longer linked to Rowboat');
  const updated: LinkedFolder = { ...folder, name: trimmed };
  await writeRegistry(folders.map((f) => (f.id === id ? updated : f)));
  return updated;
}
