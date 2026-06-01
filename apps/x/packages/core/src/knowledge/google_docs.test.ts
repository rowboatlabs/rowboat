import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google Docs ⇄ local .docx round-trip.
 *
 * Import exports the Doc as a Word document (full fidelity) and registers the
 * link in a hidden JSON registry (a .docx can't carry frontmatter). Sync down
 * re-exports and overwrites the file; sync up uploads the local .docx back into
 * the same Google Doc, guarded against clobbering remote edits.
 */

const REGISTRY_ABS = '/ws/knowledge/.assets/google-docs/links.json';

// Virtual filesystem: absolute path → contents.
let vfs: Map<string, string | Buffer>;
let exportCalls: Array<{ fileId: string; mimeType: string }>;
let updateCalls: Array<{ fileId: string }>;
let getMediaCalls: number;

const GDOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeDriveFile() {
  return {
    id: 'doc-123',
    name: 'My Doc',
    webViewLink: 'https://docs.google.com/document/d/doc-123/edit',
    modifiedTime: '2026-05-28T10:00:00.000Z',
    mimeType: GDOC_MIME,
    owners: [{ displayName: 'Arjun', emailAddress: 'arjun@example.com' }],
  };
}
let driveFile = makeDriveFile();
const docxBytes = () => new TextEncoder().encode('DOCX_BYTES').buffer;
const downloadedBytes = () => new TextEncoder().encode('DOWNLOADED').buffer;

function seedRegistry(entries: Record<string, unknown>) {
  vfs.set(REGISTRY_ABS, JSON.stringify(entries));
}

function readRegistry(): Record<string, Record<string, unknown>> {
  const raw = vfs.get(REGISTRY_ABS);
  return raw ? JSON.parse(raw as string) : {};
}

beforeEach(() => {
  vi.resetModules();
  vfs = new Map();
  exportCalls = [];
  updateCalls = [];
  getMediaCalls = 0;
  driveFile = makeDriveFile();

  vi.doMock('node:fs/promises', () => ({
    default: {
      readFile: vi.fn(async (p: string) => {
        if (!vfs.has(p)) throw new Error(`ENOENT: ${p}`);
        return vfs.get(p);
      }),
      writeFile: vi.fn(async (p: string, data: string | Buffer) => { vfs.set(p, data); }),
      mkdir: vi.fn(async () => undefined),
      access: vi.fn(async (p: string) => { if (!vfs.has(p)) throw new Error(`ENOENT: ${p}`); }),
    },
  }));

  vi.doMock('../workspace/workspace.js', () => ({
    resolveWorkspacePath: (rel: string) => `/ws/${rel.replace(/\\/g, '/')}`,
  }));

  vi.doMock('./google-client-factory.js', () => ({
    GoogleClientFactory: {
      getClient: vi.fn(async () => ({})),
      getCredentialStatus: vi.fn(async () => ({
        connected: true,
        hasRequiredScopes: true,
        missingScopes: [],
      })),
    },
  }));

  const driveClient = {
    files: {
      get: vi.fn(async (params: { alt?: string }) => {
        if (params.alt === 'media') { getMediaCalls += 1; return { data: downloadedBytes() }; }
        return { data: driveFile };
      }),
      export: vi.fn(async (params: { fileId: string; mimeType: string }) => {
        exportCalls.push({ fileId: params.fileId, mimeType: params.mimeType });
        return { data: docxBytes() };
      }),
      list: vi.fn(async () => ({ data: { files: [driveFile] } })),
      update: vi.fn(async (params: { fileId: string }) => {
        updateCalls.push({ fileId: params.fileId });
        return { data: {} };
      }),
    },
  };

  vi.doMock('googleapis', () => ({
    google: { drive: vi.fn(() => driveClient), docs: vi.fn(() => ({})) },
  }));
});

afterEach(() => { vi.clearAllMocks(); });

describe('importGoogleDoc', () => {
  it('exports a .docx, writes it to the folder, and registers the link', async () => {
    const { importGoogleDoc } = await import('./google_docs.js');
    const result = await importGoogleDoc('doc-123', 'knowledge');

    expect(exportCalls).toEqual([{ fileId: 'doc-123', mimeType: DOCX_MIME }]);
    expect(result.path).toBe('knowledge/My Doc.docx');

    // The .docx bytes landed on disk.
    expect(vfs.has('/ws/knowledge/My Doc.docx')).toBe(true);
    expect(Buffer.isBuffer(vfs.get('/ws/knowledge/My Doc.docx'))).toBe(true);

    // The link was recorded with the remote revision for conflict detection.
    const link = readRegistry()['knowledge/My Doc.docx'];
    expect(link).toMatchObject({
      id: 'doc-123',
      title: 'My Doc',
      mimeType: GDOC_MIME,
      remoteModifiedTime: '2026-05-28T10:00:00.000Z',
    });
  });

  it('downloads an uploaded .docx file directly (no export, no double extension)', async () => {
    driveFile = { ...makeDriveFile(), name: 'Report.docx', mimeType: DOCX_MIME };
    const { importGoogleDoc } = await import('./google_docs.js');
    const result = await importGoogleDoc('doc-123', 'knowledge');

    // Uploaded Word file → files.get(alt=media), not files.export.
    expect(exportCalls).toHaveLength(0);
    expect(getMediaCalls).toBe(1);
    // No "Report.docx.docx".
    expect(result.path).toBe('knowledge/Report.docx');
    expect(readRegistry()['knowledge/Report.docx'].mimeType).toBe(DOCX_MIME);
  });
});

describe('getGoogleDocLink', () => {
  it('returns the registered link, or null for an unlinked file', async () => {
    seedRegistry({
      'knowledge/My Doc.docx': { id: 'doc-123', url: 'u', title: 'My Doc', syncedAt: 's' },
    });
    const { getGoogleDocLink } = await import('./google_docs.js');
    expect(await getGoogleDocLink('knowledge/My Doc.docx')).toMatchObject({ id: 'doc-123' });
    expect(await getGoogleDocLink('knowledge/Other.docx')).toBeNull();
  });
});

describe('syncGoogleDocDown', () => {
  it('re-exports the .docx and refreshes the stored revision', async () => {
    seedRegistry({
      'knowledge/My Doc.docx': {
        id: 'doc-123', url: 'u', title: 'My Doc',
        syncedAt: '2026-05-20T00:00:00.000Z', remoteModifiedTime: '2026-05-20T00:00:00.000Z',
      },
    });
    vfs.set('/ws/knowledge/My Doc.docx', Buffer.from('OLD'));

    const { syncGoogleDocDown } = await import('./google_docs.js');
    const result = await syncGoogleDocDown('knowledge/My Doc.docx');

    expect(result.ok).toBe(true);
    expect(exportCalls).toEqual([{ fileId: 'doc-123', mimeType: DOCX_MIME }]);
    // File overwritten with fresh export, revision advanced.
    expect((vfs.get('/ws/knowledge/My Doc.docx') as Buffer).toString()).toBe('DOCX_BYTES');
    expect(readRegistry()['knowledge/My Doc.docx'].remoteModifiedTime).toBe('2026-05-28T10:00:00.000Z');
  });
});

describe('syncGoogleDocUp', () => {
  beforeEach(() => { vfs.set('/ws/knowledge/My Doc.docx', Buffer.from('LOCAL EDITS')); });

  it('blocks the push when the doc changed remotely since the last sync', async () => {
    seedRegistry({
      'knowledge/My Doc.docx': {
        id: 'doc-123', url: 'u', title: 'My Doc',
        syncedAt: '2026-05-20T00:00:00.000Z', remoteModifiedTime: '2026-05-20T00:00:00.000Z',
      },
    });
    const { syncGoogleDocUp } = await import('./google_docs.js');
    const result = await syncGoogleDocUp('knowledge/My Doc.docx');

    expect(result.synced).toBe(false);
    expect(result.conflict).toBe(true);
    expect(updateCalls).toHaveLength(0);
  });

  it('overwrites on force, uploading the local .docx back to the Google Doc', async () => {
    seedRegistry({
      'knowledge/My Doc.docx': {
        id: 'doc-123', url: 'u', title: 'My Doc',
        syncedAt: '2026-05-20T00:00:00.000Z', remoteModifiedTime: '2026-05-20T00:00:00.000Z',
      },
    });
    const { syncGoogleDocUp } = await import('./google_docs.js');
    const result = await syncGoogleDocUp('knowledge/My Doc.docx', { force: true });

    expect(result.synced).toBe(true);
    expect(updateCalls).toEqual([{ fileId: 'doc-123' }]);
    expect(readRegistry()['knowledge/My Doc.docx'].remoteModifiedTime).toBe('2026-05-28T10:00:00.000Z');
  });

  it('pushes straight through when the baseline matches the remote', async () => {
    seedRegistry({
      'knowledge/My Doc.docx': {
        id: 'doc-123', url: 'u', title: 'My Doc',
        syncedAt: '2026-05-28T10:00:00.000Z', remoteModifiedTime: '2026-05-28T10:00:00.000Z',
      },
    });
    const { syncGoogleDocUp } = await import('./google_docs.js');
    const result = await syncGoogleDocUp('knowledge/My Doc.docx');

    expect(result.synced).toBe(true);
    expect(updateCalls).toEqual([{ fileId: 'doc-123' }]);
  });
});

describe('isRemoteAhead', () => {
  it('detects a newer remote revision and tolerates missing baselines', async () => {
    const { isRemoteAhead } = await import('./google_docs.js');
    expect(isRemoteAhead('2026-05-28T10:00:00.000Z', '2026-05-20T00:00:00.000Z')).toBe(true);
    expect(isRemoteAhead('2026-05-20T00:00:00.000Z', '2026-05-28T10:00:00.000Z')).toBe(false);
    expect(isRemoteAhead('2026-05-28T10:00:00.000Z', undefined)).toBe(false);
    expect(isRemoteAhead(null, '2026-05-20T00:00:00.000Z')).toBe(false);
  });
});
