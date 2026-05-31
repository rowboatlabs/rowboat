import fs from 'node:fs/promises';
import path from 'node:path';
import { google, drive_v3 as drive, docs_v1 } from 'googleapis';
import { WorkDir } from '../config/config.js';
import { resolveWorkspacePath } from '../workspace/workspace.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { markdownToDocsRequests } from './markdown-to-docs.js';

export const GOOGLE_DOC_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
] as const;

export type GoogleDocListItem = {
  id: string;
  name: string;
  url: string;
  modifiedTime: string | null;
  owner: string | null;
};

type GoogleDocFrontmatter = {
  id: string;
  url: string;
  title: string;
  syncedAt?: string;
  // Drive `modifiedTime` (RFC3339) captured at the last sync, used to detect
  // remote edits before a sync-up would overwrite them.
  remoteModifiedTime?: string;
};

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
// Google Docs natively export to Markdown, which preserves headings, bold,
// lists, links and tables on the way into the local note — far better fidelity
// than the old text/plain export.
const MARKDOWN_MIME = 'text/markdown';

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'Google Doc';
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeKnowledgeDir(targetFolder: string): string {
  const normalized = targetFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === 'knowledge') return 'knowledge';
  if (!normalized.startsWith('knowledge/')) {
    throw new Error('Google Docs can only be added under knowledge/.');
  }
  return normalized;
}

function buildStubContent(doc: GoogleDocFrontmatter, snapshot: string): string {
  const syncedAt = doc.syncedAt ?? new Date().toISOString();
  const lines = [
    '---',
    'source:',
    '  - google-doc',
    'google_doc:',
    `  id: ${yamlQuote(doc.id)}`,
    `  url: ${yamlQuote(doc.url)}`,
    `  title: ${yamlQuote(doc.title)}`,
    `  syncedAt: ${yamlQuote(syncedAt)}`,
  ];
  if (doc.remoteModifiedTime) {
    lines.push(`  remoteModifiedTime: ${yamlQuote(doc.remoteModifiedTime)}`);
  }
  lines.push('---', '', snapshot.trimEnd(), '');
  return lines.join('\n');
}

function parseLinkedGoogleDoc(markdown: string): GoogleDocFrontmatter | null {
  if (!markdown.startsWith('---')) return null;
  const endIndex = markdown.indexOf('\n---', 3);
  if (endIndex === -1) return null;
  const raw = markdown.slice(0, endIndex + 4);
  const lines = raw.split('\n');
  let inGoogleDoc = false;
  const doc: Partial<GoogleDocFrontmatter> = {};

  for (const line of lines) {
    if (line === '---') {
      inGoogleDoc = false;
      continue;
    }
    const topLevel = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (topLevel) {
      inGoogleDoc = topLevel[1] === 'google_doc';
      continue;
    }
    if (!inGoogleDoc) continue;
    const nested = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!nested) continue;
    const key = nested[1] as keyof GoogleDocFrontmatter;
    let value = nested[2].trim();
    if (!['id', 'url', 'title', 'syncedAt', 'remoteModifiedTime'].includes(key)) continue;
    try {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = JSON.parse(value);
      }
    } catch {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    doc[key] = value;
  }

  if (!doc.id || !doc.url || !doc.title) return null;
  return doc as GoogleDocFrontmatter;
}

function bodyFromMarkdown(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const endIndex = markdown.indexOf('\n---', 3);
  if (endIndex === -1) return markdown;
  let body = markdown.slice(endIndex + 4);
  if (body.startsWith('\n')) body = body.slice(1);
  return body;
}

/**
 * True when the Google Doc has been edited remotely since our last recorded
 * sync — i.e. a sync-up would clobber changes we never pulled. Missing
 * timestamps (e.g. legacy notes with no baseline) are treated as "not ahead"
 * so the push is allowed rather than blocked forever.
 */
export function isRemoteAhead(
  remoteModifiedTime: string | null | undefined,
  lastKnownModifiedTime: string | undefined,
): boolean {
  if (!remoteModifiedTime || !lastKnownModifiedTime) return false;
  const remote = Date.parse(remoteModifiedTime);
  const known = Date.parse(lastKnownModifiedTime);
  if (Number.isNaN(remote) || Number.isNaN(known)) return false;
  return remote > known;
}

async function getDriveClient() {
  const auth = await GoogleClientFactory.getClient();
  if (!auth) throw new Error('Google is not connected.');
  return google.drive({ version: 'v3', auth });
}

async function getDocsClient() {
  const auth = await GoogleClientFactory.getClient();
  if (!auth) throw new Error('Google is not connected.');
  return google.docs({ version: 'v1', auth });
}

async function exportDocMarkdown(fileId: string): Promise<string> {
  const driveClient = await getDriveClient();
  const result = await driveClient.files.export(
    { fileId, mimeType: MARKDOWN_MIME },
    { responseType: 'text' },
  );
  return typeof result.data === 'string' ? result.data : String(result.data ?? '');
}

async function getDocMetadata(fileId: string): Promise<GoogleDocListItem> {
  const driveClient = await getDriveClient();
  const result = await driveClient.files.get({
    fileId,
    fields: 'id,name,webViewLink,modifiedTime,owners(displayName,emailAddress)',
  });
  const file = result.data;
  if (!file.id || !file.name) throw new Error('Selected Google Doc is missing metadata.');
  return toGoogleDocListItem(file);
}

function toGoogleDocListItem(file: drive.Schema$File): GoogleDocListItem {
  return {
    id: file.id ?? '',
    name: file.name ?? 'Untitled Google Doc',
    url: file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`,
    modifiedTime: file.modifiedTime ?? null,
    owner: file.owners?.[0]?.displayName ?? file.owners?.[0]?.emailAddress ?? null,
  };
}

async function uniqueKnowledgePath(targetFolder: string, title: string): Promise<string> {
  const folder = normalizeKnowledgeDir(targetFolder);
  const base = sanitizeFilename(title);
  let candidate = `${folder}/${base}.md`;
  let index = 1;
  while (true) {
    try {
      await fs.access(resolveWorkspacePath(candidate));
      candidate = `${folder}/${base}-${index}.md`;
      index += 1;
    } catch {
      return candidate;
    }
  }
}

export async function getGoogleDocsConnectionStatus(): Promise<{
  connected: boolean;
  hasRequiredScopes: boolean;
  missingScopes: string[];
}> {
  return GoogleClientFactory.getCredentialStatus([...GOOGLE_DOC_SCOPES]);
}

export async function listGoogleDocs(query?: string): Promise<{ files: GoogleDocListItem[] }> {
  const status = await getGoogleDocsConnectionStatus();
  if (!status.connected) throw new Error('Google is not connected.');
  if (!status.hasRequiredScopes) throw new Error('Google is missing Drive/Docs scopes. Reconnect Google.');

  const driveClient = await getDriveClient();
  const clauses = [`mimeType='${GOOGLE_DOC_MIME}'`, 'trashed=false'];
  const trimmed = query?.trim();
  if (trimmed) {
    clauses.push(`name contains '${escapeDriveQueryValue(trimmed)}'`);
  }
  const result = await driveClient.files.list({
    q: clauses.join(' and '),
    pageSize: 25,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,webViewLink,modifiedTime,owners(displayName,emailAddress))',
  });

  return { files: (result.data.files ?? []).map(toGoogleDocListItem).filter((file) => file.id) };
}

export async function importGoogleDoc(fileId: string, targetFolder: string): Promise<{
  path: string;
  doc: GoogleDocListItem;
}> {
  const status = await getGoogleDocsConnectionStatus();
  if (!status.connected) throw new Error('Google is not connected.');
  if (!status.hasRequiredScopes) throw new Error('Google is missing Drive/Docs scopes. Reconnect Google.');

  const doc = await getDocMetadata(fileId);
  const snapshot = await exportDocMarkdown(fileId);
  const relPath = await uniqueKnowledgePath(targetFolder, doc.name);
  const absPath = resolveWorkspacePath(relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, buildStubContent({
    id: doc.id,
    url: doc.url,
    title: doc.name,
    syncedAt: new Date().toISOString(),
    remoteModifiedTime: doc.modifiedTime ?? undefined,
  }, snapshot), 'utf8');
  return { path: relPath, doc };
}

export async function refreshGoogleDocSnapshot(relPath: string): Promise<{ ok: true; syncedAt: string }> {
  const absPath = resolveWorkspacePath(relPath);
  const markdown = await fs.readFile(absPath, 'utf8');
  const linked = parseLinkedGoogleDoc(markdown);
  if (!linked) throw new Error('This note is not linked to a Google Doc.');

  const [snapshot, meta] = await Promise.all([
    exportDocMarkdown(linked.id),
    getDocMetadata(linked.id),
  ]);
  const syncedAt = new Date().toISOString();
  await fs.writeFile(absPath, buildStubContent({
    ...linked,
    syncedAt,
    remoteModifiedTime: meta.modifiedTime ?? linked.remoteModifiedTime,
  }, snapshot), 'utf8');
  return { ok: true, syncedAt };
}

export async function syncLinkedGoogleDocFromMarkdown(
  relPath: string,
  markdown: string,
  opts: { force?: boolean } = {},
): Promise<{ synced: boolean; syncedAt?: string; conflict?: boolean; error?: string }> {
  try {
    const normalized = relPath.replace(/\\/g, '/');
    if (!normalized.startsWith('knowledge/') || !normalized.endsWith('.md')) return { synced: false };
    const linked = parseLinkedGoogleDoc(markdown);
    if (!linked) return { synced: false };

    // Conflict guard: don't silently overwrite remote edits we never pulled.
    if (!opts.force) {
      const meta = await getDocMetadata(linked.id);
      if (isRemoteAhead(meta.modifiedTime, linked.remoteModifiedTime)) {
        return {
          synced: false,
          conflict: true,
          error: 'The Google Doc changed since your last sync. Pull the latest, or overwrite it.',
        };
      }
    }

    const body = bodyFromMarkdown(markdown);
    const docsClient = await getDocsClient();
    const current = await docsClient.documents.get({
      documentId: linked.id,
      fields: 'body(content(endIndex))',
    });
    const endIndex = current.data.body?.content?.at(-1)?.endIndex ?? 1;
    const requests: docs_v1.Schema$Request[] = [];
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      });
    }
    // Recreate the body with structure preserved (headings, emphasis, lists, links).
    requests.push(...markdownToDocsRequests(body, 1));
    if (requests.length > 0) {
      await docsClient.documents.batchUpdate({
        documentId: linked.id,
        requestBody: { requests },
      });
    }

    // Re-read the revision so our stored baseline reflects this push and the
    // next sync-up won't see a phantom conflict.
    const meta = await getDocMetadata(linked.id);
    const absPath = path.join(WorkDir, normalized);
    const syncedAt = new Date().toISOString();
    await fs.writeFile(absPath, buildStubContent({
      ...linked,
      syncedAt,
      remoteModifiedTime: meta.modifiedTime ?? linked.remoteModifiedTime,
    }, body), 'utf8');
    return { synced: true, syncedAt };
  } catch (error) {
    console.error('[GoogleDocs] Failed to sync linked Google Doc:', error);
    return { synced: false, error: error instanceof Error ? error.message : String(error) };
  }
}
