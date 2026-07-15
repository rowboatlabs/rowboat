import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';
import { resolveWorkspacePath } from '../workspace/workspace.js';

/**
 * Bulk note import from other apps:
 *  - Obsidian: the user picks their vault folder; markdown, folders, and
 *    attachments are copied across with `[[wiki links]]` and `![[embeds]]`
 *    rewritten to this app's knowledge-relative link form.
 *  - Notion: the user picks a "Markdown & CSV" export .zip; the 32-hex page
 *    ids Notion appends to every file/folder name are stripped and the
 *    URL-encoded relative links between pages become `[[wiki links]]`.
 *
 * Notes land under a new subfolder of the chosen knowledge folder. Attachments
 * go to `knowledge/.assets/imports/…` (hidden from the tree) and are referenced
 * via the `app://workspace/<rel-path>` protocol so they render in the editor.
 * No index bookkeeping is needed — the workspace watcher picks up the files.
 */

export type ImportNotesSummary = {
  notes: number;
  attachments: number;
  skipped: number;
  // Workspace-relative folder the notes landed in (navigate here after import).
  root: string;
};

type ImportMode = 'obsidian' | 'notion';

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100_000;
const MAX_ZIP_UNCOMPRESSED = 4 * 1024 * 1024 * 1024;
// App/config folders that should never be imported as notes.
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '.smart-env', 'node_modules']);

// Notion appends the page id to every exported file/folder name, e.g.
// "Meeting Notes 1429279e49d24b02a8a6a7f4d449f37c.md" (or a dashed UUID).
const NOTION_ID_SUFFIX = /[ _-]([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type SourceFile = {
  abs: string;
  rel: string; // '/'-separated path relative to the source root
};

type PlannedNote = {
  abs: string;
  srcRel: string;
  destRel: string; // workspace-relative, e.g. knowledge/My Vault/Note.md
  wikiPath: string; // knowledge-stripped, extension-less, e.g. My Vault/Note
};

type PlannedAsset = {
  abs: string;
  srcRel: string;
  destRel: string; // workspace-relative, under knowledge/.assets/imports/
  url: string; // app://workspace/<destRel>, URL-encoded per segment
};

type LinkMaps = {
  // Keys are lowercased source-relative paths without extension, plus bare
  // basenames (Obsidian's "shortest path" links carry no folders).
  noteByRel: Map<string, PlannedNote>;
  noteByBase: Map<string, PlannedNote>;
  assetByRel: Map<string, PlannedAsset>;
  assetByBase: Map<string, PlannedAsset>;
};

// Characters that are illegal in workspace filenames or would break the
// [[wiki link]] syntax that note paths get embedded into.
function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
    .replace(/[. ]+$/, '');
  return cleaned || 'Untitled';
}

function stripNotionId(stem: string): string {
  return stem.replace(NOTION_ID_SUFFIX, '');
}

function splitExt(name: string): { stem: string; ext: string } {
  const ext = path.posix.extname(name);
  return { stem: name.slice(0, name.length - ext.length), ext };
}

// Map a source-relative path to its destination-relative shape: strip Notion
// ids (notion mode) and sanitize every segment.
function mapRelPath(rel: string, mode: ImportMode): string {
  return rel
    .split('/')
    .map((segment, i, all) => {
      const isFile = i === all.length - 1;
      const { stem, ext } = isFile ? splitExt(segment) : { stem: segment, ext: '' };
      const mapped = mode === 'notion' ? stripNotionId(stem) : stem;
      return sanitizeSegment(mapped) + ext.toLowerCase();
    })
    .join('/');
}

async function walkDir(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  async function visit(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Hidden files and app-internal folders (.obsidian, .DS_Store, …).
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(abs, childRel);
      } else if (entry.isFile()) {
        out.push({ abs, rel: childRel });
      }
    }
  }
  await visit(root, '');
  return out;
}

function normalizeKnowledgeDir(targetFolder: string): string {
  const normalized = targetFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === 'knowledge') return 'knowledge';
  if (!normalized.startsWith('knowledge/')) {
    throw new Error('Notes can only be imported under knowledge/.');
  }
  return normalized;
}

async function uniqueChildDir(parentRel: string, name: string): Promise<string> {
  let candidate = name;
  let index = 1;
  while (true) {
    try {
      await fs.access(resolveWorkspacePath(`${parentRel}/${candidate}`));
      index += 1;
      candidate = `${name} ${index}`;
    } catch {
      return candidate;
    }
  }
}

function toWorkspaceUrl(destRel: string): string {
  return 'app://workspace/' + destRel.split('/').map(encodeURIComponent).join('/');
}

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Lookup keys for a link target as written in a note: resolved against the
// note's own folder, against the source root, and by bare basename.
function relKey(rel: string): string {
  const { stem, ext } = splitExt(rel);
  return (ext.toLowerCase() === '.md' ? stem : rel).toLowerCase();
}

function resolveTarget<T>(
  target: string,
  noteSrcDir: string,
  byRel: Map<string, T>,
  byBase: Map<string, T>,
): T | undefined {
  const decoded = tryDecode(target).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!decoded || decoded.startsWith('/')) return undefined;
  const fromNoteDir = path.posix.normalize(path.posix.join(noteSrcDir, decoded));
  const fromRoot = path.posix.normalize(decoded);
  for (const candidate of [fromNoteDir, fromRoot]) {
    if (candidate.startsWith('..')) continue;
    const hit = byRel.get(relKey(candidate));
    if (hit) return hit;
  }
  const base = decoded.split('/').pop() ?? decoded;
  return byBase.get(relKey(base));
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#');
}

// Split out fenced/inline code so link rewriting never touches code samples.
// Odd indices of the result are the code spans (kept verbatim).
function splitCode(content: string): string[] {
  return content.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/);
}

function parseWikiTarget(raw: string): { target: string; heading?: string; alias?: string } {
  const pipe = raw.indexOf('|');
  const alias = pipe === -1 ? undefined : raw.slice(pipe + 1).trim() || undefined;
  const beforeAlias = pipe === -1 ? raw : raw.slice(0, pipe);
  const hash = beforeAlias.indexOf('#');
  const heading = hash === -1 ? undefined : beforeAlias.slice(hash + 1).trim() || undefined;
  const target = (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim();
  return { target, heading, alias };
}

function buildWikiLink(wikiPath: string, heading?: string, alias?: string): string {
  return `[[${wikiPath}${heading ? `#${heading}` : ''}${alias ? `|${alias}` : ''}]]`;
}

function transformNoteContent(content: string, noteSrcDir: string, maps: LinkMaps): string {
  const rewriteSegment = (text: string): string => {
    let out = text;

    // Obsidian embeds: ![[image.png]] / ![[Some Note]].
    out = out.replace(/!\[\[([^[\]]+)\]\]/g, (_match, raw: string) => {
      const { target, heading, alias } = parseWikiTarget(raw);
      const asset = resolveTarget(target, noteSrcDir, maps.assetByRel, maps.assetByBase);
      if (asset) return `![${alias ?? ''}](${asset.url})`;
      const note = resolveTarget(target, noteSrcDir, maps.noteByRel, maps.noteByBase);
      if (note) return buildWikiLink(note.wikiPath, heading, alias);
      return `[[${raw}]]`;
    });

    // Wiki links: [[Note]], [[Folder/Note#Heading|alias]]. Rewrite to the full
    // knowledge-relative path so they resolve after import.
    out = out.replace(/(?<!!)\[\[([^[\]]+)\]\]/g, (match, raw: string) => {
      const { target, heading, alias } = parseWikiTarget(raw);
      const note = resolveTarget(target, noteSrcDir, maps.noteByRel, maps.noteByBase);
      if (note) return buildWikiLink(note.wikiPath, heading, alias);
      return match;
    });

    // Markdown links & images with relative targets — Notion's inter-page
    // links ([Page](Page%20Name%20<id>.md)) and both apps' image references.
    out = out.replace(
      /(!?)\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g,
      (match, bang: string, label: string, target: string) => {
        if (isExternalTarget(target)) return match;
        const asset = resolveTarget(target, noteSrcDir, maps.assetByRel, maps.assetByBase);
        if (asset) return `${bang}[${label}](${asset.url})`;
        const note = resolveTarget(target, noteSrcDir, maps.noteByRel, maps.noteByBase);
        if (note) return buildWikiLink(note.wikiPath, undefined, label.trim() || undefined);
        return match;
      },
    );

    return out;
  };

  return splitCode(content)
    .map((segment, i) => (i % 2 === 1 ? segment : rewriteSegment(segment)))
    .join('');
}

async function importTree(
  sourceRoot: string,
  targetFolder: string,
  opts: { mode: ImportMode; rootName: string },
): Promise<ImportNotesSummary> {
  const folder = normalizeKnowledgeDir(targetFolder);
  const files = await walkDir(sourceRoot);
  if (!files.some((f) => f.rel.toLowerCase().endsWith('.md'))) {
    throw new Error(
      opts.mode === 'notion'
        ? 'No markdown pages found in the export. In Notion, choose Export → "Markdown & CSV".'
        : 'No markdown notes found in that folder.',
    );
  }

  const rootName = await uniqueChildDir(folder, sanitizeSegment(opts.rootName));
  const rootRel = `${folder}/${rootName}`;
  const assetsRootRel = `knowledge/.assets/imports/${rootName}`;

  const notes: PlannedNote[] = [];
  const assets: PlannedAsset[] = [];
  const maps: LinkMaps = {
    noteByRel: new Map(),
    noteByBase: new Map(),
    assetByRel: new Map(),
    assetByBase: new Map(),
  };
  // Dedupe destination paths — stripping Notion ids can collide siblings.
  const takenDest = new Set<string>();
  const claimDest = (candidate: string): string => {
    if (!takenDest.has(candidate.toLowerCase())) {
      takenDest.add(candidate.toLowerCase());
      return candidate;
    }
    const { stem, ext } = splitExt(candidate);
    for (let i = 2; ; i++) {
      const next = `${stem} ${i}${ext}`;
      if (!takenDest.has(next.toLowerCase())) {
        takenDest.add(next.toLowerCase());
        return next;
      }
    }
  };

  for (const file of files) {
    const mappedRel = claimDest(mapRelPath(file.rel, opts.mode));
    const isNote = path.posix.extname(file.rel).toLowerCase() === '.md';
    const srcKey = relKey(file.rel.toLowerCase());
    const srcBaseKey = relKey((file.rel.split('/').pop() ?? file.rel).toLowerCase());
    if (isNote) {
      const note: PlannedNote = {
        abs: file.abs,
        srcRel: file.rel,
        destRel: `${rootRel}/${mappedRel}`,
        wikiPath: `${rootRel.replace(/^knowledge\//, '')}/${mappedRel.replace(/\.md$/i, '')}`,
      };
      notes.push(note);
      maps.noteByRel.set(srcKey, note);
      if (!maps.noteByBase.has(srcBaseKey)) maps.noteByBase.set(srcBaseKey, note);
    } else {
      const asset: PlannedAsset = {
        abs: file.abs,
        srcRel: file.rel,
        destRel: `${assetsRootRel}/${mappedRel}`,
        url: '',
      };
      asset.url = toWorkspaceUrl(asset.destRel);
      assets.push(asset);
      maps.assetByRel.set(srcKey, asset);
      if (!maps.assetByBase.has(srcBaseKey)) maps.assetByBase.set(srcBaseKey, asset);
    }
  }

  let skipped = 0;
  let copiedAssets = 0;

  for (const asset of assets) {
    try {
      const stat = await fs.stat(asset.abs);
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        skipped += 1;
        continue;
      }
      const dest = resolveWorkspacePath(asset.destRel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(asset.abs, dest);
      copiedAssets += 1;
    } catch (err) {
      console.error(`[ImportNotes] Failed to copy attachment ${asset.srcRel}:`, err);
      skipped += 1;
    }
  }

  let writtenNotes = 0;
  const noteSrcDir = (srcRel: string): string => path.posix.dirname(srcRel).replace(/^\.$/, '');
  for (const note of notes) {
    try {
      const raw = await fs.readFile(note.abs, 'utf8');
      const transformed = transformNoteContent(raw, noteSrcDir(note.srcRel), maps);
      const dest = resolveWorkspacePath(note.destRel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, transformed, 'utf8');
      writtenNotes += 1;
    } catch (err) {
      console.error(`[ImportNotes] Failed to import note ${note.srcRel}:`, err);
      skipped += 1;
    }
  }

  return { notes: writtenNotes, attachments: copiedAssets, skipped, root: rootRel };
}

// Extract a zip with zip-slip/symlink guards (same discipline as apps/installer).
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new Error(`Could not read the zip file: ${String(err)}`));
      let entries = 0;
      let uncompressed = 0;

      zip.on('entry', (entry: yauzl.Entry) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) {
          zip.close();
          return reject(new Error('The export contains too many files.'));
        }
        const name = entry.fileName;
        if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || name.includes('\0')) {
          zip.close();
          return reject(new Error(`Unsafe path in zip: ${name}`));
        }
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0xf000) === 0xa000) {
          zip.readEntry();
          return;
        }
        if (name.endsWith('/')) {
          fs.mkdir(path.join(destDir, name), { recursive: true }).then(() => zip.readEntry(), reject);
          return;
        }
        uncompressed += entry.uncompressedSize;
        if (uncompressed > MAX_ZIP_UNCOMPRESSED) {
          zip.close();
          return reject(new Error('The export is too large to import.'));
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            zip.close();
            return reject(new Error(`Could not read the zip file: ${String(streamErr)}`));
          }
          const dest = path.join(destDir, name);
          void fs.mkdir(path.dirname(dest), { recursive: true }).then(() => {
            const out = createWriteStream(dest);
            stream.pipe(out);
            out.on('close', () => zip.readEntry());
            out.on('error', reject);
            stream.on('error', reject);
          }, reject);
        });
      });

      zip.on('end', () => resolve());
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Notion export zips often wrap everything in a single "Export-<uuid>/" folder
// (and large exports ship as nested Part-N.zip files). Unwrap to the real root.
async function findContentRoot(dir: string): Promise<string> {
  for (let depth = 0; depth < 4; depth++) {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(
      (e) => !e.name.startsWith('.') && !e.name.startsWith('__MACOSX'),
    );
    const dirs = entries.filter((e) => e.isDirectory());
    const filesHere = entries.filter((e) => e.isFile());
    if (dirs.length === 1 && filesHere.length === 0) {
      dir = path.join(dir, dirs[0].name);
      continue;
    }
    break;
  }
  return dir;
}

/** Import an Obsidian vault (or any folder of markdown notes). */
export async function importObsidianVault(
  vaultPath: string,
  targetFolder: string,
): Promise<ImportNotesSummary> {
  const stat = await fs.stat(vaultPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Choose the folder that contains your vault.');
  const rootName = path.basename(vaultPath) || 'Obsidian import';
  return importTree(vaultPath, targetFolder, { mode: 'obsidian', rootName });
}

/** Import a Notion "Markdown & CSV" export zip. */
export async function importNotionExport(
  zipPath: string,
  targetFolder: string,
): Promise<ImportNotesSummary> {
  const stat = await fs.stat(zipPath).catch(() => null);
  if (!stat?.isFile() || !zipPath.toLowerCase().endsWith('.zip')) {
    throw new Error('Choose the .zip file downloaded from Notion (Export → Markdown & CSV).');
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-notion-import-'));
  try {
    await extractZip(zipPath, tmp);
    // Multi-part exports: a zip of Part-N.zip files. Extract those in place.
    const top = await fs.readdir(tmp, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        const nested = path.join(tmp, entry.name);
        await extractZip(nested, tmp);
        await fs.rm(nested, { force: true });
      }
    }
    const root = await findContentRoot(tmp);
    return await importTree(root, targetFolder, { mode: 'notion', rootName: 'Notion import' });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
