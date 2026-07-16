import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkMaps, PlannedAsset, PlannedNote } from './import_notes.js';

type ImportNotesModule = typeof import('./import_notes.js');

// Real-shaped Notion page ids (32 hex chars / dashed UUID).
const ID_A = '1429279e49d24b02a8a6a7f4d449f37c';
const ID_B = 'abcdef0123456789abcdef0123456789';
const ID_UUID = '1429279e-49d2-4b02-a8a6-a7f4d449f37c';

let tmpDir: string;
let workspaceDir: string;
let mod: ImportNotesModule;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-import-test-'));
  workspaceDir = path.join(tmpDir, 'workspace');
  process.env.ROWBOAT_WORKDIR = workspaceDir;
  vi.resetModules();
  // config.ts fire-and-forgets initRepo() on load, which would git-init
  // knowledge/ in the temp workspace and race the afterEach cleanup. The mock
  // is deliberately never unmocked: that in-flight dynamic import can resolve
  // after the test ends, and unmocking would hand it the real module.
  vi.doMock('./version_history.js', () => ({
    initRepo: vi.fn(async () => undefined),
    commitAll: vi.fn(async () => undefined),
    onCommit: vi.fn(() => () => undefined),
  }));
  mod = await import('./import_notes.js');
});

afterEach(async () => {
  delete process.env.ROWBOAT_WORKDIR;
  await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// ---------------------------------------------------------------------------
// Zip fixture builder — minimal STORE-method zip (local headers + central
// directory + EOCD), so tests don't need a zip-writing dependency.

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntrySpec = {
  name: string;
  data?: string | Buffer;
  // Full external-attributes word; high 16 bits hold the unix mode.
  externalAttrs?: number;
};

function buildZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date
    local.writeUInt32LE(crc, 16);
    local.writeUInt32LE(data.length, 20);
    local.writeUInt32LE(data.length, 24);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.externalAttrs ?? 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

async function writeZip(name: string, entries: ZipEntrySpec[]): Promise<string> {
  const zipPath = path.join(tmpDir, name);
  await fs.writeFile(zipPath, buildZip(entries));
  return zipPath;
}

// Build LinkMaps the same way importTree's planning pass does — including its
// shallowest-path-wins rule for duplicate basenames.
function makeMaps(notes: PlannedNote[], assets: PlannedAsset[]): LinkMaps {
  const depth = (rel: string) => rel.split('/').length;
  const claimBase = <T extends { srcRel: string }>(map: Map<string, T>, item: T) => {
    const key = mod.relKey(item.srcRel.split('/').pop() ?? item.srcRel);
    const prev = map.get(key);
    if (!prev || depth(item.srcRel) < depth(prev.srcRel)) map.set(key, item);
  };
  const maps: LinkMaps = {
    noteByRel: new Map(),
    noteByBase: new Map(),
    assetByRel: new Map(),
    assetByBase: new Map(),
  };
  for (const note of notes) {
    maps.noteByRel.set(mod.relKey(note.srcRel), note);
    claimBase(maps.noteByBase, note);
  }
  for (const asset of assets) {
    maps.assetByRel.set(mod.relKey(asset.srcRel), asset);
    claimBase(maps.assetByBase, asset);
  }
  return maps;
}

function plannedNote(srcRel: string, wikiPath: string): PlannedNote {
  return { abs: `/src/${srcRel}`, srcRel, destRel: `knowledge/${wikiPath}.md`, wikiPath };
}

function plannedAsset(srcRel: string, opts?: { copied?: boolean }): PlannedAsset {
  const destRel = `knowledge/.assets/imports/Import/${srcRel}`;
  return {
    abs: `/src/${srcRel}`,
    srcRel,
    destRel,
    url: 'app://workspace/' + destRel.split('/').map(encodeURIComponent).join('/'),
    copied: opts?.copied ?? true,
  };
}

// ---------------------------------------------------------------------------

describe('sanitizeSegment', () => {
  it('replaces illegal filename and wiki-link characters with spaces', () => {
    expect(mod.sanitizeSegment('a:b*c?d"e<f>g|h#i^j[k]l')).toBe('a b c d e f g h i j k l');
  });

  it('collapses whitespace and trims', () => {
    expect(mod.sanitizeSegment('  Meeting   Notes  ')).toBe('Meeting Notes');
  });

  it('strips trailing dots and spaces', () => {
    expect(mod.sanitizeSegment('Notes...')).toBe('Notes');
  });

  it('caps segment length at 150 characters', () => {
    expect(mod.sanitizeSegment('x'.repeat(200))).toHaveLength(150);
  });

  it('falls back to Untitled when nothing survives', () => {
    expect(mod.sanitizeSegment('...')).toBe('Untitled');
    expect(mod.sanitizeSegment('###')).toBe('Untitled');
  });
});

describe('stripNotionId', () => {
  it('strips a space-separated 32-hex page id', () => {
    expect(mod.stripNotionId(`Meeting Notes ${ID_A}`)).toBe('Meeting Notes');
  });

  it('strips a dashed UUID page id', () => {
    expect(mod.stripNotionId(`Meeting Notes ${ID_UUID}`)).toBe('Meeting Notes');
  });

  it('strips underscore- and dash-separated ids', () => {
    expect(mod.stripNotionId(`Page_${ID_A}`)).toBe('Page');
    expect(mod.stripNotionId(`Page-${ID_A}`)).toBe('Page');
  });

  it('leaves names without a trailing id untouched', () => {
    expect(mod.stripNotionId('Meeting Notes')).toBe('Meeting Notes');
    expect(mod.stripNotionId('Version 1a2b3c')).toBe('Version 1a2b3c');
    expect(mod.stripNotionId(`${ID_A} in the middle`)).toBe(`${ID_A} in the middle`);
  });
});

describe('mapRelPath', () => {
  it('keeps obsidian paths, sanitizing segments and lowercasing extensions', () => {
    expect(mod.mapRelPath('Folder/Note.MD', 'obsidian')).toBe('Folder/Note.md');
    expect(mod.mapRelPath('What?/Really#1.md', 'obsidian')).toBe('What/Really 1.md');
  });

  it('strips notion ids from every path segment', () => {
    expect(mod.mapRelPath(`Parent ${ID_A}/Child ${ID_B}.md`, 'notion')).toBe('Parent/Child.md');
  });

  it('only strips ids from the stem, keeping the extension', () => {
    expect(mod.mapRelPath(`image ${ID_A}.PNG`, 'notion')).toBe('image.png');
  });

  it('does not strip ids in obsidian mode', () => {
    expect(mod.mapRelPath(`Note ${ID_A}.md`, 'obsidian')).toBe(`Note ${ID_A}.md`);
  });
});

describe('parseWikiTarget', () => {
  it('parses a bare target', () => {
    expect(mod.parseWikiTarget('Note')).toEqual({ target: 'Note', heading: undefined, alias: undefined });
  });

  it('parses heading and alias', () => {
    expect(mod.parseWikiTarget('Folder/Note#Heading|alias')).toEqual({
      target: 'Folder/Note',
      heading: 'Heading',
      alias: 'alias',
    });
  });

  it('parses alias without heading', () => {
    expect(mod.parseWikiTarget('Note|shown')).toEqual({ target: 'Note', heading: undefined, alias: 'shown' });
  });

  it('treats empty heading and alias as absent', () => {
    expect(mod.parseWikiTarget('Note#|')).toEqual({ target: 'Note', heading: undefined, alias: undefined });
  });
});

describe('splitCode', () => {
  it('puts fenced blocks and inline code at odd indices', () => {
    const parts = mod.splitCode('before `inline` middle\n```\nfenced\n```\nafter');
    expect(parts[1]).toBe('`inline`');
    expect(parts[3]).toBe('```\nfenced\n```');
    expect(parts[0]).toBe('before ');
    expect(parts[4]).toBe('\nafter');
  });

  it('keeps an unterminated fence as a code span', () => {
    const parts = mod.splitCode('text\n```\nnever closed');
    expect(parts[1]).toBe('```\nnever closed');
  });

  it('round-trips content when rejoined', () => {
    const content = 'a `b` c\n```js\nd\n```\ne';
    expect(mod.splitCode(content).join('')).toBe(content);
  });
});

describe('relKey', () => {
  it('treats NFC and NFD forms of the same name as one key', () => {
    // macOS readdir returns NFD names; links inside notes are typically NFC.
    expect(mod.relKey('Caf\u00e9.md')).toBe(mod.relKey('Cafe\u0301.md'));
    expect(mod.relKey('S\u00fcb/Pic.png')).toBe(mod.relKey('Su\u0308b/Pic.png'));
  });
});

describe('transformNoteContent', () => {
  const target = plannedNote('Sub/Target.md', 'Import/Sub/Target');
  const pic = plannedAsset('images/pic.png');

  it('rewrites a bare wiki link to the full knowledge-relative path', () => {
    const maps = makeMaps([target], []);
    expect(mod.transformNoteContent('See [[Target]].', '', maps)).toBe('See [[Import/Sub/Target]].');
  });

  it('preserves heading and alias on rewritten wiki links', () => {
    const maps = makeMaps([target], []);
    expect(mod.transformNoteContent('[[Target#Plan|the plan]]', '', maps)).toBe('[[Import/Sub/Target#Plan|the plan]]');
  });

  it('prefers a note-dir-relative match over a basename match', () => {
    const other = plannedNote('Other/Target.md', 'Import/Other/Target');
    // walk order puts Other first, so the basename map points at Other's copy
    const maps = makeMaps([other, target], []);
    expect(mod.transformNoteContent('[[Target]]', 'Sub', maps)).toBe('[[Import/Sub/Target]]');
    expect(mod.transformNoteContent('[[Target]]', 'Elsewhere', maps)).toBe('[[Import/Other/Target]]');
  });

  it('leaves unresolvable wiki links untouched', () => {
    const maps = makeMaps([target], []);
    expect(mod.transformNoteContent('[[Missing Note|alias]]', '', maps)).toBe('[[Missing Note|alias]]');
  });

  it('rewrites asset embeds to image tags with the workspace url', () => {
    const maps = makeMaps([], [pic]);
    expect(mod.transformNoteContent('![[pic.png]]', '', maps)).toBe(`![](${pic.url})`);
    expect(mod.transformNoteContent('![[pic.png|300]]', '', maps)).toBe(`![300](${pic.url})`);
  });

  it('degrades note transclusions to plain wiki links', () => {
    const maps = makeMaps([target], []);
    expect(mod.transformNoteContent('![[Target]]', '', maps)).toBe('[[Import/Sub/Target]]');
  });

  it('rewrites url-encoded notion page links to wiki links', () => {
    const sub = plannedNote(`Parent ${ID_A}/Sub Page ${ID_B}.md`, 'Notion import/Parent/Sub Page');
    const maps = makeMaps([sub], []);
    const content = `[Sub Page](Parent%20${ID_A}/Sub%20Page%20${ID_B}.md)`;
    expect(mod.transformNoteContent(content, '', maps)).toBe('[[Notion import/Parent/Sub Page|Sub Page]]');
  });

  it('rewrites relative markdown images to the workspace url', () => {
    const maps = makeMaps([], [pic]);
    expect(mod.transformNoteContent('![diagram](images/pic.png)', '', maps)).toBe(`![diagram](${pic.url})`);
  });

  it('resolves markdown links relative to the note folder', () => {
    const maps = makeMaps([], [plannedAsset('Sub/data.csv')]);
    const out = mod.transformNoteContent('[data](data.csv)', 'Sub', maps);
    expect(out).toContain('app://workspace/knowledge/.assets/imports/Import/Sub/data.csv');
  });

  it('leaves external urls and anchors untouched', () => {
    const maps = makeMaps([target], [pic]);
    const content = '[a](https://example.com/pic.png) [b](mailto:x@y.z) [c](#section)';
    expect(mod.transformNoteContent(content, '', maps)).toBe(content);
  });

  it('never rewrites inside code fences or inline code', () => {
    const maps = makeMaps([target], [pic]);
    const content = 'Real: [[Target]]\n```\n[[Target]] ![[pic.png]]\n```\nInline `[[Target]]` end';
    const out = mod.transformNoteContent(content, '', maps);
    expect(out).toBe('Real: [[Import/Sub/Target]]\n```\n[[Target]] ![[pic.png]]\n```\nInline `[[Target]]` end');
  });

  it('leaves links to assets that never copied untouched', () => {
    const missing = plannedAsset('big/video.mp4', { copied: false });
    const maps = makeMaps([], [missing]);
    expect(mod.transformNoteContent('![[video.mp4]]', '', maps)).toBe('![[video.mp4]]');
    expect(mod.transformNoteContent('![clip](big/video.mp4)', '', maps)).toBe('![clip](big/video.mp4)');
  });

  it('carries markdown link #anchors over as wiki headings', () => {
    const sub = plannedNote(`Parent ${ID_A}/Sub Page ${ID_B}.md`, 'Notion import/Parent/Sub Page');
    const maps = makeMaps([sub], []);
    const content = `[Sec](Parent%20${ID_A}/Sub%20Page%20${ID_B}.md#Some%20Heading)`;
    expect(mod.transformNoteContent(content, '', maps)).toBe('[[Notion import/Parent/Sub Page#Some Heading|Sec]]');
  });

  it('rewrites angle-bracketed markdown targets containing spaces', () => {
    const note = plannedNote('Sub/My Note.md', 'Import/Sub/My Note');
    const maps = makeMaps([note], [pic]);
    expect(mod.transformNoteContent('[n](<Sub/My Note.md>)', '', maps)).toBe('[[Import/Sub/My Note|n]]');
    expect(mod.transformNoteContent('![p](<images/pic.png>)', '', maps)).toBe(`![p](${pic.url})`);
  });

  it('resolves NFC-written links against NFD source filenames', () => {
    const nfd = plannedNote('Cafe\u0301 Notes.md', 'Import/Caf\u00e9 Notes');
    const maps = makeMaps([nfd], []);
    expect(mod.transformNoteContent('[[Caf\u00e9 Notes]]', '', maps)).toBe('[[Import/Caf\u00e9 Notes]]');
  });

  it('leaves YAML frontmatter alone', () => {
    const maps = makeMaps([target], []);
    const content = '---\ntitle: T\nrelated: "[[Target]]"\n---\n\n[[Target]]';
    expect(mod.transformNoteContent(content, '', maps)).toBe(
      '---\ntitle: T\nrelated: "[[Target]]"\n---\n\n[[Import/Sub/Target]]',
    );
  });

  it('treats an unclosed leading --- as body, not frontmatter', () => {
    const maps = makeMaps([target], []);
    expect(mod.transformNoteContent('---\nnot closed\n[[Target]]', '', maps)).toBe(
      '---\nnot closed\n[[Import/Sub/Target]]',
    );
  });

  it('prefers the shallowest note for duplicate basenames', () => {
    const deep = plannedNote('A/B/Note.md', 'Import/A/B/Note');
    const shallow = plannedNote('Note.md', 'Import/Note');
    // insertion order deliberately puts the deep note first
    const maps = makeMaps([deep, shallow], []);
    expect(mod.transformNoteContent('[[Note]]', 'Elsewhere', maps)).toBe('[[Import/Note]]');
  });
});

describe('findContentRoot', () => {
  it('unwraps a chain of single-directory wrappers', async () => {
    const inner = path.join(tmpDir, 'unwrap', 'Export abc', 'workspace');
    await fs.mkdir(inner, { recursive: true });
    await fs.writeFile(path.join(inner, 'note.md'), 'x');
    expect(await mod.findContentRoot(path.join(tmpDir, 'unwrap'))).toBe(inner);
  });

  it('stops where files live alongside directories', async () => {
    const root = path.join(tmpDir, 'mixed');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'page.md'), 'x');
    expect(await mod.findContentRoot(root)).toBe(root);
  });

  it('ignores hidden and __MACOSX entries when unwrapping', async () => {
    const root = path.join(tmpDir, 'macos');
    await fs.mkdir(path.join(root, '__MACOSX'), { recursive: true });
    await fs.mkdir(path.join(root, 'Export'), { recursive: true });
    await fs.writeFile(path.join(root, '.DS_Store'), 'x');
    await fs.writeFile(path.join(root, 'Export', 'page.md'), 'x');
    expect(await mod.findContentRoot(root)).toBe(path.join(root, 'Export'));
  });

  it('descends at most four levels', async () => {
    const root = path.join(tmpDir, 'deep');
    const parts = ['a', 'b', 'c', 'd', 'e', 'f'];
    await fs.mkdir(path.join(root, ...parts), { recursive: true });
    expect(await mod.findContentRoot(root)).toBe(path.join(root, 'a', 'b', 'c', 'd'));
  });
});

describe('extractZip', () => {
  it('extracts files and directory entries', async () => {
    const zipPath = await writeZip('ok.zip', [
      { name: 'dir/' },
      { name: 'dir/file.txt', data: 'hello' },
      { name: 'root.md', data: '# hi' },
    ]);
    const dest = path.join(tmpDir, 'out-ok');
    await mod.extractZip(zipPath, dest);
    expect(await fs.readFile(path.join(dest, 'dir', 'file.txt'), 'utf8')).toBe('hello');
    expect(await fs.readFile(path.join(dest, 'root.md'), 'utf8')).toBe('# hi');
  });

  it('rejects zip-slip and absolute entry names', async () => {
    // '..' and absolute names are refused by yauzl itself, before our own
    // guard runs. Either way extraction must reject and write nothing.
    for (const name of ['../evil.txt', '/abs.txt']) {
      const zipPath = await writeZip(`slip-${crc32(Buffer.from(name))}.zip`, [{ name, data: 'x' }]);
      const dest = path.join(tmpDir, 'out-slip');
      await expect(mod.extractZip(zipPath, dest)).rejects.toThrow(/Unsafe path|invalid relative path|absolute path/);
      await expect(fs.access(path.join(tmpDir, 'evil.txt'))).rejects.toThrow();
    }
  });

  it('normalizes backslash entry names to safe forward-slash paths', async () => {
    // yauzl converts backslashes to '/' before our guard sees the name.
    const zipPath = await writeZip('backslash.zip', [{ name: 'a\\b.txt', data: 'x' }]);
    const dest = path.join(tmpDir, 'out-backslash');
    await mod.extractZip(zipPath, dest);
    expect(await fs.readFile(path.join(dest, 'a', 'b.txt'), 'utf8')).toBe('x');
  });

  it('skips symlink entries', async () => {
    const zipPath = await writeZip('symlink.zip', [
      { name: 'link.md', data: '/etc/passwd', externalAttrs: (0o120644 << 16) >>> 0 },
      { name: 'real.md', data: 'ok' },
    ]);
    const dest = path.join(tmpDir, 'out-symlink');
    await mod.extractZip(zipPath, dest);
    expect(await fs.readFile(path.join(dest, 'real.md'), 'utf8')).toBe('ok');
    await expect(fs.access(path.join(dest, 'link.md'))).rejects.toThrow();
  });

  it('rejects files that are not zips', async () => {
    const zipPath = path.join(tmpDir, 'garbage.zip');
    await fs.writeFile(zipPath, 'not a zip at all');
    await expect(mod.extractZip(zipPath, path.join(tmpDir, 'out-garbage'))).rejects.toThrow(/Could not read the zip file/);
  });
});

describe('importObsidianVault', () => {
  async function makeVault(name: string): Promise<string> {
    const vault = path.join(tmpDir, name);
    await fs.mkdir(path.join(vault, 'Sub'), { recursive: true });
    await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(vault, 'Note A.md'), 'Link: [[Note B]] Embed: ![[pic.png]]');
    await fs.writeFile(path.join(vault, 'Sub', 'Note B.md'), 'body');
    await fs.writeFile(path.join(vault, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(vault, '.obsidian', 'app.json'), '{}');
    await fs.writeFile(path.join(vault, '.hidden.md'), 'skipped');
    return vault;
  }

  it('imports notes and attachments, rewriting links to the new root', async () => {
    const vault = await makeVault('MyVault');
    const summary = await mod.importObsidianVault(vault, 'knowledge');

    expect(summary).toEqual({ notes: 2, attachments: 1, skipped: 0, root: 'knowledge/MyVault' });

    const noteA = await fs.readFile(path.join(workspaceDir, 'knowledge', 'MyVault', 'Note A.md'), 'utf8');
    expect(noteA).toContain('[[MyVault/Sub/Note B]]');
    expect(noteA).toContain('![](app://workspace/knowledge/.assets/imports/MyVault/pic.png)');
    await expect(fs.access(path.join(workspaceDir, 'knowledge', '.assets', 'imports', 'MyVault', 'pic.png'))).resolves.toBeUndefined();
    // App-internal and hidden files never come across.
    await expect(fs.access(path.join(workspaceDir, 'knowledge', 'MyVault', '.obsidian'))).rejects.toThrow();
    await expect(fs.access(path.join(workspaceDir, 'knowledge', 'MyVault', '.hidden.md'))).rejects.toThrow();
  });

  it('never merges into an existing folder — the root gets a numeric suffix', async () => {
    await fs.mkdir(path.join(workspaceDir, 'knowledge', 'MyVault'), { recursive: true });
    const vault = await makeVault('MyVault');
    const summary = await mod.importObsidianVault(vault, 'knowledge');
    expect(summary.root).toBe('knowledge/MyVault 2');
  });

  it('rejects paths that are not directories', async () => {
    const file = path.join(tmpDir, 'not-a-vault.md');
    await fs.writeFile(file, 'x');
    await expect(mod.importObsidianVault(file, 'knowledge')).rejects.toThrow(/folder/);
  });

  it('rejects folders with no markdown notes', async () => {
    const empty = path.join(tmpDir, 'empty-vault');
    await fs.mkdir(empty, { recursive: true });
    await fs.writeFile(path.join(empty, 'data.csv'), 'a,b');
    await expect(mod.importObsidianVault(empty, 'knowledge')).rejects.toThrow(/No markdown notes/);
  });

  it('only imports under knowledge/', async () => {
    const vault = await makeVault('EscapeVault');
    await expect(mod.importObsidianVault(vault, 'somewhere-else')).rejects.toThrow(/knowledge/);
  });
});

describe('importNotionExport', () => {
  it('imports a wrapped export, stripping ids and rewriting page links and images', async () => {
    const wrapper = `Export ${ID_A}`;
    const zipPath = await writeZip('notion.zip', [
      {
        name: `${wrapper}/Parent ${ID_B}.md`,
        data: `# Parent\n\n[Sub Page](Parent%20${ID_B}/Sub%20Page%20${ID_A}.md)\n\n![img](image.png)`,
      },
      { name: `${wrapper}/Parent ${ID_B}/Sub Page ${ID_A}.md`, data: 'sub body' },
      { name: `${wrapper}/image.png`, data: Buffer.from([1, 2, 3]) },
    ]);

    const summary = await mod.importNotionExport(zipPath, 'knowledge');
    expect(summary).toEqual({ notes: 2, attachments: 1, skipped: 0, root: 'knowledge/Notion import' });

    const parent = await fs.readFile(path.join(workspaceDir, 'knowledge', 'Notion import', 'Parent.md'), 'utf8');
    expect(parent).toContain('[[Notion import/Parent/Sub Page|Sub Page]]');
    expect(parent).toContain('![img](app://workspace/knowledge/.assets/imports/Notion%20import/image.png)');
    await expect(fs.access(path.join(workspaceDir, 'knowledge', 'Notion import', 'Parent', 'Sub Page.md'))).resolves.toBeUndefined();
  });

  it('suffixes siblings that collide after id stripping, deterministically', async () => {
    const zipPath = await writeZip('collide.zip', [
      { name: `Page ${ID_B}.md`, data: 'second' },
      { name: `Page ${ID_A}.md`, data: 'first' },
    ]);
    const summary = await mod.importNotionExport(zipPath, 'knowledge');
    expect(summary.notes).toBe(2);
    const root = path.join(workspaceDir, 'knowledge', 'Notion import');
    // Suffixes are assigned in sorted source order, not zip/readdir order.
    expect(await fs.readFile(path.join(root, 'Page.md'), 'utf8')).toBe('first');
    expect(await fs.readFile(path.join(root, 'Page 2.md'), 'utf8')).toBe('second');
  });

  it('keeps same-named sibling folders separate after id stripping', async () => {
    const zipPath = await writeZip('folders.zip', [
      { name: `Page ${ID_A}/Alpha ${ID_A}.md`, data: 'a' },
      { name: `Page ${ID_B}/Alpha ${ID_B}.md`, data: 'b' },
      {
        name: `Index ${ID_UUID}.md`,
        data: `[A](Page%20${ID_A}/Alpha%20${ID_A}.md) [B](Page%20${ID_B}/Alpha%20${ID_B}.md)`,
      },
    ]);
    const summary = await mod.importNotionExport(zipPath, 'knowledge');
    expect(summary.notes).toBe(3);
    const root = path.join(workspaceDir, 'knowledge', 'Notion import');
    expect(await fs.readFile(path.join(root, 'Page', 'Alpha.md'), 'utf8')).toBe('a');
    expect(await fs.readFile(path.join(root, 'Page 2', 'Alpha.md'), 'utf8')).toBe('b');
    // Links follow each page into its own folder instead of a merged one.
    const index = await fs.readFile(path.join(root, 'Index.md'), 'utf8');
    expect(index).toBe('[[Notion import/Page/Alpha|A]] [[Notion import/Page 2/Alpha|B]]');
  });

  it('extracts nested Part-N.zip multi-part exports', async () => {
    const inner = buildZip([{ name: `Note ${ID_A}.md`, data: 'from part 1' }]);
    const zipPath = await writeZip('multipart.zip', [{ name: 'Part-1.zip', data: inner }]);
    const summary = await mod.importNotionExport(zipPath, 'knowledge');
    expect(summary.notes).toBe(1);
    const note = await fs.readFile(path.join(workspaceDir, 'knowledge', 'Notion import', 'Note.md'), 'utf8');
    expect(note).toBe('from part 1');
  });

  it('rejects paths that are not .zip files', async () => {
    const file = path.join(tmpDir, 'export.txt');
    await fs.writeFile(file, 'x');
    await expect(mod.importNotionExport(file, 'knowledge')).rejects.toThrow(/\.zip/);
  });

  it('rejects exports with no markdown pages', async () => {
    const zipPath = await writeZip('no-md.zip', [{ name: 'data.csv', data: 'a,b' }]);
    await expect(mod.importNotionExport(zipPath, 'knowledge')).rejects.toThrow(/Markdown & CSV/);
  });
});
