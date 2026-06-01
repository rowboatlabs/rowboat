import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { google, drive_v3 as drive } from 'googleapis';
import { resolveWorkspacePath } from '../workspace/workspace.js';
import { GoogleClientFactory } from './google-client-factory.js';

// Full Drive scope: export Google Docs to .docx (read) and write the edited
// .docx back via files.update (write). drive.readonly can't do the write half.
export const GOOGLE_DOC_SCOPES = [
  'https://www.googleapis.com/auth/drive',
] as const;

export type GoogleDocListItem = {
  id: string;
  name: string;
  url: string;
  modifiedTime: string | null;
  owner: string | null;
  // Drive mimeType — distinguishes a native Google Doc (needs export) from an
  // uploaded Word file (download its bytes directly).
  mimeType: string;
};

// Metadata linking a local .docx file to its source Drive file. Stored in a
// registry (see LINKS_REL) because a .docx is binary and can't carry the
// frontmatter a markdown note would.
export type GoogleDocLink = {
  id: string;
  url: string;
  title: string;
  syncedAt: string;
  // Source Drive mimeType (native Google Doc vs uploaded .docx) — decides
  // whether a pull exports or downloads.
  mimeType?: string;
  // Drive `modifiedTime` (RFC3339) at the last sync — used to detect remote
  // edits before a sync-up would overwrite them.
  remoteModifiedTime?: string;
};

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
// A native Google Doc is exported to / written back as a real Word document so
// the in-app docx editor round-trips it with full fidelity. Uploaded .docx
// files already are Word documents and are downloaded/uploaded as-is.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Hidden registry mapping workspace-relative .docx paths → their Google Doc.
// Lives under .assets so workspace:readdir (includeHidden:false) keeps it out
// of the Knowledge tree.
const LINKS_REL = 'knowledge/.assets/google-docs/links.json';

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

function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function normalizeKnowledgeDir(targetFolder: string): string {
  const normalized = normalizeRel(targetFolder).replace(/\/+$/, '');
  if (!normalized || normalized === 'knowledge') return 'knowledge';
  if (!normalized.startsWith('knowledge/')) {
    throw new Error('Google Docs can only be added under knowledge/.');
  }
  return normalized;
}

/**
 * True when the Google Doc has been edited remotely since our last recorded
 * sync — i.e. a sync-up would clobber changes we never pulled. Missing
 * timestamps (e.g. links created before a baseline existed) are treated as
 * "not ahead" so the push is allowed rather than blocked forever.
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

// --- Link registry ---------------------------------------------------------

async function readLinks(): Promise<Record<string, GoogleDocLink>> {
  try {
    const raw = await fs.readFile(resolveWorkspacePath(LINKS_REL), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLinks(map: Record<string, GoogleDocLink>): Promise<void> {
  const absPath = resolveWorkspacePath(LINKS_REL);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, JSON.stringify(map, null, 2), 'utf8');
}

async function setLink(relPath: string, link: GoogleDocLink): Promise<void> {
  const links = await readLinks();
  links[normalizeRel(relPath)] = link;
  await writeLinks(links);
}

/** The Google Doc linked to a local .docx, or null if the file isn't linked. */
export async function getGoogleDocLink(relPath: string): Promise<GoogleDocLink | null> {
  const links = await readLinks();
  return links[normalizeRel(relPath)] ?? null;
}

// --- Drive / Docs clients --------------------------------------------------

async function getDriveClient() {
  const auth = await GoogleClientFactory.getClient();
  if (!auth) throw new Error('Google is not connected.');
  return google.drive({ version: 'v3', auth });
}

// Get the file as .docx bytes: a native Google Doc is exported; an uploaded
// Word file is downloaded as-is.
async function fetchAsDocx(fileId: string, mimeType: string | undefined): Promise<Buffer> {
  const driveClient = await getDriveClient();
  if (!mimeType || mimeType === GOOGLE_DOC_MIME) {
    const result = await driveClient.files.export(
      { fileId, mimeType: DOCX_MIME },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(result.data as ArrayBuffer);
  }
  const result = await driveClient.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(result.data as ArrayBuffer);
}

async function getDocMetadata(fileId: string): Promise<GoogleDocListItem> {
  const driveClient = await getDriveClient();
  const result = await driveClient.files.get({
    fileId,
    fields: 'id,name,webViewLink,modifiedTime,mimeType,owners(displayName,emailAddress)',
    supportsAllDrives: true,
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
    mimeType: file.mimeType ?? GOOGLE_DOC_MIME,
  };
}

async function uniqueDocxPath(targetFolder: string, title: string): Promise<string> {
  const folder = normalizeKnowledgeDir(targetFolder);
  // Strip an existing .docx so an uploaded "Report.docx" doesn't become "Report.docx.docx".
  const base = sanitizeFilename(title.replace(/\.docx$/i, ''));
  let candidate = `${folder}/${base}.docx`;
  let index = 1;
  while (true) {
    try {
      await fs.access(resolveWorkspacePath(candidate));
      candidate = `${folder}/${base}-${index}.docx`;
      index += 1;
    } catch {
      return candidate;
    }
  }
}

// --- Public API ------------------------------------------------------------

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
  if (!status.hasRequiredScopes) throw new Error('Google is missing Drive access. Reconnect Google.');

  const driveClient = await getDriveClient();
  // Native Google Docs (exportable) and uploaded Word files (downloadable).
  const typeClause = `(mimeType='${GOOGLE_DOC_MIME}' or mimeType='${DOCX_MIME}')`;
  const clauses = [typeClause, 'trashed=false'];
  const trimmed = query?.trim();
  if (trimmed) {
    clauses.push(`name contains '${escapeDriveQueryValue(trimmed)}'`);
  }
  const q = clauses.join(' and ');
  const result = await driveClient.files.list({
    q,
    pageSize: 25,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,webViewLink,modifiedTime,mimeType,owners(displayName,emailAddress))',
    // Also surface docs in shared drives and "Shared with me", not just My Drive.
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  const files = (result.data.files ?? []).map(toGoogleDocListItem).filter((file) => file.id);
  console.log(`[GoogleDocs] list q="${q}" → ${files.length} doc(s)`);
  return { files };
}

/** Import a Google Doc as a local .docx and register the link. */
export async function importGoogleDoc(fileId: string, targetFolder: string): Promise<{
  path: string;
  doc: GoogleDocListItem;
}> {
  const status = await getGoogleDocsConnectionStatus();
  if (!status.connected) throw new Error('Google is not connected.');
  if (!status.hasRequiredScopes) throw new Error('Google is missing Drive access. Reconnect Google.');

  const doc = await getDocMetadata(fileId);
  const bytes = await fetchAsDocx(fileId, doc.mimeType);
  const relPath = await uniqueDocxPath(targetFolder, doc.name);
  const absPath = resolveWorkspacePath(relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, bytes);
  await setLink(relPath, {
    id: doc.id,
    url: doc.url,
    title: doc.name,
    syncedAt: new Date().toISOString(),
    mimeType: doc.mimeType,
    remoteModifiedTime: doc.modifiedTime ?? undefined,
  });
  return { path: relPath, doc };
}

/** Pull the latest Google Doc and overwrite the local .docx. */
export async function syncGoogleDocDown(relPath: string): Promise<{ ok: true; syncedAt: string }> {
  const link = await getGoogleDocLink(relPath);
  if (!link) throw new Error('This file is not linked to a Google Doc.');

  const [bytes, meta] = await Promise.all([
    fetchAsDocx(link.id, link.mimeType),
    getDocMetadata(link.id),
  ]);
  await fs.writeFile(resolveWorkspacePath(normalizeRel(relPath)), bytes);
  const syncedAt = new Date().toISOString();
  await setLink(relPath, {
    id: link.id,
    url: link.url,
    title: link.title,
    syncedAt,
    mimeType: link.mimeType ?? meta.mimeType,
    remoteModifiedTime: meta.modifiedTime ?? link.remoteModifiedTime,
  });
  return { ok: true, syncedAt };
}

/** Push the local .docx back into the Google Doc (in place, preserving its id/URL). */
export async function syncGoogleDocUp(
  relPath: string,
  opts: { force?: boolean } = {},
): Promise<{ synced: boolean; syncedAt?: string; conflict?: boolean; error?: string }> {
  try {
    const link = await getGoogleDocLink(relPath);
    if (!link) return { synced: false, error: 'This file is not linked to a Google Doc.' };

    // Conflict guard: don't silently overwrite remote edits we never pulled.
    if (!opts.force) {
      const meta = await getDocMetadata(link.id);
      if (isRemoteAhead(meta.modifiedTime, link.remoteModifiedTime)) {
        return {
          synced: false,
          conflict: true,
          error: 'The Google Doc changed since your last sync. Pull the latest, or overwrite it.',
        };
      }
    }

    const bytes = await fs.readFile(resolveWorkspacePath(normalizeRel(relPath)));
    const driveClient = await getDriveClient();
    // For a native Google Doc, uploading .docx media converts it back into the
    // existing doc (id/URL/type preserved). For an uploaded .docx file, it just
    // replaces the bytes.
    await driveClient.files.update({
      fileId: link.id,
      media: { mimeType: DOCX_MIME, body: Readable.from(bytes) },
      supportsAllDrives: true,
    });

    const meta = await getDocMetadata(link.id);
    const syncedAt = new Date().toISOString();
    await setLink(relPath, {
      id: link.id,
      url: link.url,
      title: link.title,
      syncedAt,
      mimeType: link.mimeType ?? meta.mimeType,
      remoteModifiedTime: meta.modifiedTime ?? link.remoteModifiedTime,
    });
    return { synced: true, syncedAt };
  } catch (error) {
    console.error('[GoogleDocs] Failed to sync linked Google Doc:', error);
    return { synced: false, error: error instanceof Error ? error.message : String(error) };
  }
}
