import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 1 — read-path fidelity.
 *
 * Google Docs are pulled in as Markdown (text/markdown export), not flattened
 * to text/plain, so headings / bold / lists / links survive into the local
 * note. Import and sync-down also record the Drive `modifiedTime` in
 * frontmatter so a later sync-up can detect remote edits.
 */

const MARKDOWN_SNAPSHOT = [
  '# Title',
  '',
  'Some **bold** and a [link](https://example.com).',
  '',
  '- one',
  '- two',
].join('\n');

// In-memory capture of the most recent writeFile.
let written: { path: string; content: string } | null = null;
let readFileContent = '';
let exportCalls: Array<{ fileId: string; mimeType: string }> = [];

const driveFile = {
  id: 'doc-123',
  name: 'My Doc',
  webViewLink: 'https://docs.google.com/document/d/doc-123/edit',
  modifiedTime: '2026-05-28T10:00:00.000Z',
  owners: [{ displayName: 'Arjun', emailAddress: 'arjun@example.com' }],
};

beforeEach(() => {
  vi.resetModules();
  written = null;
  exportCalls = [];

  vi.doMock('node:fs/promises', () => ({
    default: {
      readFile: vi.fn(async () => readFileContent),
      writeFile: vi.fn(async (path: string, content: string) => { written = { path, content }; }),
      mkdir: vi.fn(async () => undefined),
      access: vi.fn(async () => { throw new Error('ENOENT'); }),
    },
  }));

  vi.doMock('../config/config.js', () => ({ WorkDir: '/ws' }));
  vi.doMock('../workspace/workspace.js', () => ({
    resolveWorkspacePath: (rel: string) => `/ws/${rel}`,
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
      get: vi.fn(async () => ({ data: driveFile })),
      export: vi.fn(async (params: { fileId: string; mimeType: string }) => {
        exportCalls.push({ fileId: params.fileId, mimeType: params.mimeType });
        return { data: MARKDOWN_SNAPSHOT };
      }),
      list: vi.fn(async () => ({ data: { files: [driveFile] } })),
    },
  };

  vi.doMock('googleapis', () => ({
    google: {
      drive: vi.fn(() => driveClient),
      docs: vi.fn(() => ({ documents: { get: vi.fn(), batchUpdate: vi.fn() } })),
    },
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('importGoogleDoc', () => {
  it('exports as Markdown (not plain text) and keeps the formatting in the note body', async () => {
    const { importGoogleDoc } = await import('./google_docs.js');
    const result = await importGoogleDoc('doc-123', 'knowledge');

    expect(exportCalls).toEqual([{ fileId: 'doc-123', mimeType: 'text/markdown' }]);
    expect(result.path).toBe('knowledge/My Doc.md');
    expect(written).not.toBeNull();

    const content = written!.content;
    // Markdown structure survives the import.
    expect(content).toContain('# Title');
    expect(content).toContain('**bold**');
    expect(content).toContain('[link](https://example.com)');
    expect(content).toContain('- one');
  });

  it('records the Drive modifiedTime in frontmatter for conflict detection', async () => {
    const { importGoogleDoc } = await import('./google_docs.js');
    await importGoogleDoc('doc-123', 'knowledge');

    expect(written!.content).toContain('remoteModifiedTime: "2026-05-28T10:00:00.000Z"');
    expect(written!.content).toContain('id: "doc-123"');
  });
});

describe('refreshGoogleDocSnapshot (sync down)', () => {
  it('re-exports Markdown and refreshes remoteModifiedTime while preserving the link', async () => {
    readFileContent = [
      '---',
      'source:',
      '  - google-doc',
      'google_doc:',
      '  id: "doc-123"',
      '  url: "https://docs.google.com/document/d/doc-123/edit"',
      '  title: "My Doc"',
      '  syncedAt: "2026-05-20T00:00:00.000Z"',
      '  remoteModifiedTime: "2026-05-20T00:00:00.000Z"',
      '---',
      '',
      'old body',
      '',
    ].join('\n');

    const { refreshGoogleDocSnapshot } = await import('./google_docs.js');
    const result = await refreshGoogleDocSnapshot('knowledge/My Doc.md');

    expect(result.ok).toBe(true);
    expect(exportCalls).toEqual([{ fileId: 'doc-123', mimeType: 'text/markdown' }]);
    // Body replaced with the fresh Markdown export.
    expect(written!.content).toContain('# Title');
    expect(written!.content).not.toContain('old body');
    // modifiedTime advanced to the remote value.
    expect(written!.content).toContain('remoteModifiedTime: "2026-05-28T10:00:00.000Z"');
  });
});
