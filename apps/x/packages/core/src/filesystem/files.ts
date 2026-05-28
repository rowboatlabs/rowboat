import fs from 'node:fs/promises';
import { createReadStream, type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { glob as globFiles } from 'glob';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { commitAll } from '../knowledge/version_history.js';
import { rewriteWikiLinksForRenamedKnowledgeFile } from '../workspace/wiki-link-rewrite.js';

export type FileOperation = 'read' | 'list' | 'search' | 'write' | 'delete';

export type ResolvedFilePath = {
  originalPath: string;
  resolvedPath: string;
  isInsideWorkspace: boolean;
  workspaceRelPath: string | null;
};

export type CanonicalFilePath = ResolvedFilePath & {
  canonicalPath: string;
};

export type FileStat = {
  kind: 'file' | 'dir';
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  isSymlink?: boolean;
};

export type DirEntry = {
  name: string;
  path: string;
  resolvedPath: string;
  kind: 'file' | 'dir';
  stat?: {
    size: number;
    mtimeMs: number;
  };
};

export type ReaddirOptions = {
  recursive?: boolean;
  includeStats?: boolean;
  includeHidden?: boolean;
  allowedExtensions?: string[];
};

export type WriteTextOptions = {
  atomic?: boolean;
  mkdirp?: boolean;
  expectedEtag?: string;
};

export type RemoveOptions = {
  recursive?: boolean;
  trash?: boolean;
};

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

let knowledgeCommitTimer: ReturnType<typeof setTimeout> | null = null;
let canonicalWorkspaceRoot: string | null = null;

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function expandHomePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error('Path is required');
  }
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveFilePath(inputPath: string): ResolvedFilePath {
  const originalPath = inputPath;
  const expandedPath = expandHomePath(inputPath);
  const resolvedPath = path.resolve(path.isAbsolute(expandedPath) ? expandedPath : path.join(WorkDir, expandedPath));
  const workspaceRoot = path.resolve(WorkDir);
  const isInsideWorkspace = isPathInside(workspaceRoot, resolvedPath);
  const workspaceRelPath = isInsideWorkspace
    ? path.relative(workspaceRoot, resolvedPath).split(path.sep).join('/')
    : null;
  return { originalPath, resolvedPath, isInsideWorkspace, workspaceRelPath };
}

async function getCanonicalWorkspaceRoot(): Promise<string> {
  if (canonicalWorkspaceRoot) return canonicalWorkspaceRoot;
  try {
    canonicalWorkspaceRoot = await fs.realpath(WorkDir);
  } catch {
    canonicalWorkspaceRoot = path.resolve(WorkDir);
  }
  return canonicalWorkspaceRoot;
}

async function canonicalizePathForPermission(resolvedPath: string): Promise<string> {
  try {
    return await fs.realpath(resolvedPath);
  } catch {
    const parsed = path.parse(resolvedPath);
    const missingParts: string[] = [];
    let current = resolvedPath;

    while (current !== parsed.root) {
      try {
        const canonicalParent = await fs.realpath(current);
        return path.join(canonicalParent, ...missingParts.reverse());
      } catch {
        missingParts.push(path.basename(current));
        current = path.dirname(current);
      }
    }

    return path.resolve(resolvedPath);
  }
}

export async function resolveFilePathForPermission(inputPath: string): Promise<CanonicalFilePath> {
  const resolved = resolveFilePath(inputPath);
  const [canonicalPath, workspaceRoot] = await Promise.all([
    canonicalizePathForPermission(resolved.resolvedPath),
    getCanonicalWorkspaceRoot(),
  ]);
  const isInsideWorkspace = isPathInside(workspaceRoot, canonicalPath);
  const workspaceRelPath = isInsideWorkspace
    ? path.relative(workspaceRoot, canonicalPath).split(path.sep).join('/')
    : null;
  return {
    ...resolved,
    canonicalPath,
    isInsideWorkspace,
    workspaceRelPath,
  };
}

export function computeEtag(size: number, mtimeMs: number): string {
  return `${size}:${mtimeMs}`;
}

function statToSchema(stats: Stats): FileStat {
  return {
    kind: stats.isDirectory() ? 'dir' : 'file',
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    isSymlink: stats.isSymbolicLink() ? true : undefined,
  };
}

function scheduleKnowledgeCommit(filename: string): void {
  if (knowledgeCommitTimer) {
    clearTimeout(knowledgeCommitTimer);
  }
  knowledgeCommitTimer = setTimeout(() => {
    knowledgeCommitTimer = null;
    commitAll(`Edit ${filename}`, 'You').catch(err => {
      console.error('[VersionHistory] Failed to commit after edit:', err);
    });
  }, 3 * 60 * 1000);
}

function isKnowledgeMarkdownPath(resolved: ResolvedFilePath): boolean {
  return !!resolved.workspaceRelPath
    && resolved.workspaceRelPath.startsWith('knowledge/')
    && resolved.workspaceRelPath.endsWith('.md');
}

function scheduleKnowledgeCommitIfNeeded(resolved: ResolvedFilePath): void {
  if (isKnowledgeMarkdownPath(resolved)) {
    scheduleKnowledgeCommit(path.basename(resolved.resolvedPath));
  }
}

async function assertTextFile(resolvedPath: string): Promise<void> {
  const stats = await fs.lstat(resolvedPath);
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }

  if (stats.size === 0) return;
  const handle = await fs.open(resolvedPath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stats.size, 8192));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    let nonPrintableCount = 0;
    for (let index = 0; index < sample.length; index++) {
      const byte = sample[index];
      if (byte === 0) {
        throw new Error('Refusing to read binary file as text');
      }
      if (byte < 9 || (byte > 13 && byte < 32)) {
        nonPrintableCount++;
      }
    }
    if (sample.length > 0 && nonPrintableCount / sample.length > 0.3) {
      throw new Error('Refusing to read binary file as text');
    }
    const decoded = sample.toString('utf8');
    const replacementChars = (decoded.match(/\uFFFD/g) || []).length;
    if (replacementChars > Math.max(3, decoded.length * 0.01)) {
      throw new Error('Refusing to read binary file as text');
    }
  } finally {
    await handle.close();
  }
}

export async function exists(inputPath: string): Promise<{ exists: boolean; path: string; resolvedPath: string; isInsideWorkspace: boolean }> {
  const resolved = resolveFilePath(inputPath);
  try {
    await fs.access(resolved.resolvedPath);
    return { exists: true, path: resolved.originalPath, resolvedPath: resolved.resolvedPath, isInsideWorkspace: resolved.isInsideWorkspace };
  } catch {
    return { exists: false, path: resolved.originalPath, resolvedPath: resolved.resolvedPath, isInsideWorkspace: resolved.isInsideWorkspace };
  }
}

export async function stat(inputPath: string): Promise<FileStat & { path: string; resolvedPath: string; isInsideWorkspace: boolean; etag: string }> {
  const resolved = resolveFilePath(inputPath);
  const stats = await fs.lstat(resolved.resolvedPath);
  return {
    ...statToSchema(stats),
    path: resolved.originalPath,
    resolvedPath: resolved.resolvedPath,
    isInsideWorkspace: resolved.isInsideWorkspace,
    etag: computeEtag(stats.size, stats.mtimeMs),
  };
}

export async function list(inputPath: string, opts?: ReaddirOptions): Promise<Array<DirEntry>> {
  const root = resolveFilePath(inputPath || '.');
  const entries: Array<DirEntry> = [];

  async function readDir(currentPath: string, currentDisplayPath: string): Promise<void> {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    for (const item of items) {
      if (!opts?.includeHidden && item.name.startsWith('.')) {
        continue;
      }

      const itemPath = path.join(currentPath, item.name);
      const displayPath = path.posix.join(currentDisplayPath.split(path.sep).join('/'), item.name);
      const itemKind = item.isDirectory() ? 'dir' : item.isFile() ? 'file' : null;
      if (!itemKind) continue;

      if (itemKind === 'file' && opts?.allowedExtensions?.length) {
        const ext = path.extname(item.name);
        if (!opts.allowedExtensions.includes(ext)) continue;
      }

      let itemStat: { size: number; mtimeMs: number } | undefined;
      if (opts?.includeStats) {
        const stats = await fs.lstat(itemPath);
        itemStat = { size: stats.size, mtimeMs: stats.mtimeMs };
      }

      entries.push({
        name: item.name,
        path: displayPath,
        resolvedPath: itemPath,
        kind: itemKind,
        stat: itemStat,
      });

      if (itemKind === 'dir' && opts?.recursive) {
        await readDir(itemPath, displayPath);
      }
    }
  }

  await readDir(root.resolvedPath, root.originalPath || '.');
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export async function readText(inputPath: string, offset?: number, limit?: number) {
  const resolved = resolveFilePath(inputPath);
  await assertTextFile(resolved.resolvedPath);
  const stats = await fs.lstat(resolved.resolvedPath);
  const stat = statToSchema(stats);
  const etag = computeEtag(stats.size, stats.mtimeMs);
  const effectiveOffset = offset ?? 1;
  const effectiveLimit = limit ?? DEFAULT_READ_LIMIT;
  const start = effectiveOffset - 1;

  const stream = createReadStream(resolved.resolvedPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const collected: string[] = [];
  let totalLines = 0;
  let bytes = 0;
  let truncatedByBytes = false;
  let hasMoreLines = false;

  try {
    for await (const text of rl) {
      totalLines += 1;
      if (totalLines <= start) continue;

      if (collected.length >= effectiveLimit) {
        hasMoreLines = true;
        continue;
      }

      const line = text.length > MAX_LINE_LENGTH
        ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
        : text;
      const size = Buffer.byteLength(line, 'utf-8') + (collected.length > 0 ? 1 : 0);
      if (bytes + size > MAX_BYTES) {
        truncatedByBytes = true;
        hasMoreLines = true;
        break;
      }

      collected.push(line);
      bytes += size;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (totalLines < effectiveOffset && !(totalLines === 0 && effectiveOffset === 1)) {
    return { error: `Offset ${effectiveOffset} is out of range for this file (${totalLines} lines)` };
  }

  const prefixed = collected.map((line, index) => `${index + effectiveOffset}: ${line}`);
  const lastReadLine = effectiveOffset + collected.length - 1;
  const nextOffset = lastReadLine + 1;
  let footer: string;
  if (truncatedByBytes) {
    footer = `(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${effectiveOffset}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
  } else if (hasMoreLines) {
    footer = `(Showing lines ${effectiveOffset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`;
  } else {
    footer = `(End of file - total ${totalLines} lines)`;
  }

  const content = [
    `<path>${resolved.originalPath}</path>`,
    `<resolvedPath>${resolved.resolvedPath}</resolvedPath>`,
    `<type>file</type>`,
    `<content>`,
    prefixed.join('\n'),
    '',
    footer,
    `</content>`,
  ].join('\n');

  return {
    path: resolved.originalPath,
    resolvedPath: resolved.resolvedPath,
    isInsideWorkspace: resolved.isInsideWorkspace,
    encoding: 'utf8' as const,
    content,
    stat,
    etag,
    offset: effectiveOffset,
    limit: effectiveLimit,
    totalLines,
    hasMore: hasMoreLines || truncatedByBytes,
  };
}

export async function readBuffer(inputPath: string): Promise<{ buffer: Buffer; path: string; resolvedPath: string; isInsideWorkspace: boolean }> {
  const resolved = resolveFilePath(inputPath);
  const buffer = await fs.readFile(resolved.resolvedPath);
  return {
    buffer,
    path: resolved.originalPath,
    resolvedPath: resolved.resolvedPath,
    isInsideWorkspace: resolved.isInsideWorkspace,
  };
}

export async function writeText(inputPath: string, data: string, opts?: WriteTextOptions) {
  const resolved = resolveFilePath(inputPath);
  const atomic = opts?.atomic !== false;
  const mkdirp = opts?.mkdirp !== false;

  if (mkdirp) {
    await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });
  }

  const result = await withFileLock(resolved.resolvedPath, async () => {
    if (opts?.expectedEtag) {
      const existingStats = await fs.lstat(resolved.resolvedPath);
      const existingEtag = computeEtag(existingStats.size, existingStats.mtimeMs);
      if (existingEtag !== opts.expectedEtag) {
        throw new Error('File was modified (ETag mismatch)');
      }
    }

    const buffer = Buffer.from(data, 'utf8');
    if (atomic) {
      const tempPath = `${resolved.resolvedPath}.tmp.${Date.now()}${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tempPath, buffer);
      await fs.rename(tempPath, resolved.resolvedPath);
    } else {
      await fs.writeFile(resolved.resolvedPath, buffer);
    }

    const stats = await fs.lstat(resolved.resolvedPath);
    return { stat: statToSchema(stats), etag: computeEtag(stats.size, stats.mtimeMs) };
  });

  scheduleKnowledgeCommitIfNeeded(resolved);
  return {
    path: resolved.originalPath,
    resolvedPath: resolved.resolvedPath,
    isInsideWorkspace: resolved.isInsideWorkspace,
    stat: result.stat,
    etag: result.etag,
  };
}

export async function editText(inputPath: string, oldString: string, newString: string, replaceAll = false) {
  const resolved = resolveFilePath(inputPath);
  await assertTextFile(resolved.resolvedPath);
  const content = await fs.readFile(resolved.resolvedPath, 'utf8');
  const occurrences = content.split(oldString).length - 1;

  if (occurrences === 0) {
    return { error: 'oldString not found in file' };
  }
  if (occurrences > 1 && !replaceAll) {
    return { error: `oldString found ${occurrences} times. Use replaceAll: true or provide more context to make it unique.` };
  }

  const newContent = replaceAll
    ? content.replaceAll(oldString, newString)
    : content.replace(oldString, newString);
  await writeText(inputPath, newContent, { atomic: true, mkdirp: true });
  return {
    success: true,
    path: resolved.originalPath,
    resolvedPath: resolved.resolvedPath,
    isInsideWorkspace: resolved.isInsideWorkspace,
    replacements: replaceAll ? occurrences : 1,
  };
}

export async function mkdir(inputPath: string, recursive = true): Promise<{ ok: true; path: string; resolvedPath: string; isInsideWorkspace: boolean }> {
  const resolved = resolveFilePath(inputPath);
  await fs.mkdir(resolved.resolvedPath, { recursive });
  return { ok: true, path: resolved.originalPath, resolvedPath: resolved.resolvedPath, isInsideWorkspace: resolved.isInsideWorkspace };
}

export async function rename(from: string, to: string, overwrite = false): Promise<{ ok: true; from: string; to: string; resolvedFrom: string; resolvedTo: string }> {
  const source = resolveFilePath(from);
  const dest = resolveFilePath(to);
  await fs.access(source.resolvedPath);
  const fromStats = await fs.lstat(source.resolvedPath);

  if (!overwrite) {
    try {
      await fs.access(dest.resolvedPath);
      throw new Error('Destination already exists');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // destination does not exist
      } else {
        throw err;
      }
    }
  }

  await fs.mkdir(path.dirname(dest.resolvedPath), { recursive: true });
  await fs.rename(source.resolvedPath, dest.resolvedPath);

  if (fromStats.isFile() && isKnowledgeMarkdownPath(source) && isKnowledgeMarkdownPath(dest) && source.workspaceRelPath && dest.workspaceRelPath) {
    try {
      await rewriteWikiLinksForRenamedKnowledgeFile(WorkDir, source.workspaceRelPath, dest.workspaceRelPath);
    } catch (error) {
      console.error('Failed to rewrite wiki backlinks after file rename:', error);
    }
  }

  return { ok: true, from, to, resolvedFrom: source.resolvedPath, resolvedTo: dest.resolvedPath };
}

export async function copy(from: string, to: string, overwrite = false): Promise<{ ok: true; from: string; to: string; resolvedFrom: string; resolvedTo: string }> {
  const source = resolveFilePath(from);
  const dest = resolveFilePath(to);
  const fromStats = await fs.lstat(source.resolvedPath);
  if (fromStats.isDirectory()) {
    throw new Error('Copying directories is not supported');
  }

  if (!overwrite) {
    try {
      await fs.access(dest.resolvedPath);
      throw new Error('Destination already exists');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // destination does not exist
      } else {
        throw err;
      }
    }
  }

  await fs.mkdir(path.dirname(dest.resolvedPath), { recursive: true });
  await fs.copyFile(source.resolvedPath, dest.resolvedPath);
  return { ok: true, from, to, resolvedFrom: source.resolvedPath, resolvedTo: dest.resolvedPath };
}

export async function remove(inputPath: string, opts?: RemoveOptions): Promise<{ ok: true; path: string; resolvedPath: string; trashed?: string }> {
  const resolved = resolveFilePath(inputPath);
  const stats = await fs.lstat(resolved.resolvedPath);
  const trash = opts?.trash !== false;

  if (trash) {
    const trashDir = path.join(WorkDir, '.trash');
    await fs.mkdir(trashDir, { recursive: true });
    const timestamp = Date.now();
    const basename = path.basename(resolved.resolvedPath);
    let finalTrashPath = path.join(trashDir, `${timestamp}-${basename}`);
    let counter = 1;
    while (true) {
      try {
        await fs.access(finalTrashPath);
        finalTrashPath = path.join(trashDir, `${timestamp}-${counter}-${basename}`);
        counter++;
      } catch {
        break;
      }
    }
    await fs.rename(resolved.resolvedPath, finalTrashPath);
    return { ok: true, path: resolved.originalPath, resolvedPath: resolved.resolvedPath, trashed: finalTrashPath };
  }

  if (stats.isDirectory()) {
    if (!opts?.recursive) {
      throw new Error('Cannot remove directory without recursive=true');
    }
    await fs.rm(resolved.resolvedPath, { recursive: true });
  } else {
    await fs.unlink(resolved.resolvedPath);
  }
  return { ok: true, path: resolved.originalPath, resolvedPath: resolved.resolvedPath };
}

export async function glob(pattern: string, cwd?: string): Promise<{ files: string[]; resolvedFiles: string[]; count: number; pattern: string; cwd: string; resolvedCwd: string }> {
  const root = resolveFilePath(cwd || '.');
  const files = await globFiles(pattern, {
    cwd: root.resolvedPath,
    nodir: true,
    ignore: ['node_modules/**', '.git/**'],
  });
  const resolvedFiles = files.map(file => path.resolve(root.resolvedPath, file));
  return {
    files,
    resolvedFiles,
    count: files.length,
    pattern,
    cwd: cwd || '.',
    resolvedCwd: root.resolvedPath,
  };
}

export async function grep({
  pattern,
  searchPath,
  fileGlob,
  contextLines = 0,
  maxResults = 100,
}: {
  pattern: string;
  searchPath?: string;
  fileGlob?: string;
  contextLines?: number;
  maxResults?: number;
}) {
  const root = resolveFilePath(searchPath || '.');
  const stats = await fs.lstat(root.resolvedPath);
  const candidates = stats.isDirectory()
    ? await globFiles(fileGlob || '**/*', {
      cwd: root.resolvedPath,
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
      dot: false,
    })
    : [path.basename(root.resolvedPath)];
  const baseDir = stats.isDirectory() ? root.resolvedPath : path.dirname(root.resolvedPath);
  const regex = new RegExp(pattern, 'i');
  const matches: Array<{ file: string; resolvedPath: string; line: number; content: string; before?: string[]; after?: string[] }> = [];

  for (const candidate of candidates) {
    if (matches.length >= maxResults) break;
    const resolvedPath = stats.isDirectory() ? path.resolve(baseDir, candidate) : root.resolvedPath;
    try {
      await assertTextFile(resolvedPath);
      const text = await fs.readFile(resolvedPath, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (!regex.test(lines[index])) continue;
        const before = contextLines > 0 ? lines.slice(Math.max(0, index - contextLines), index) : undefined;
        const after = contextLines > 0 ? lines.slice(index + 1, Math.min(lines.length, index + 1 + contextLines)) : undefined;
        matches.push({
          file: stats.isDirectory() ? candidate : root.originalPath,
          resolvedPath,
          line: index + 1,
          content: lines[index].trim(),
          before,
          after,
        });
        if (matches.length >= maxResults) break;
      }
    } catch {
      // Skip unreadable and binary files.
    }
  }

  return {
    matches,
    count: matches.length,
    tool: 'internal-grep',
    searchPath: searchPath || '.',
    resolvedSearchPath: root.resolvedPath,
  };
}
