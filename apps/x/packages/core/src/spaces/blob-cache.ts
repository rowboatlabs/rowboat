import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import * as orgs from './orgs.js';

// Content-addressed local cache for space blobs. The address IS the sha256 of
// the bytes, so a cache hit is correct forever — no invalidation problem
// exists. Each blob downloads once per machine, shared by every consumer:
// main's app://space-blob protocol handler and save-dialog IPC (which add
// thumbnails on top — Electron-only, so they stay in main), and the agent's
// spaces-download-blob tool.
//
// Layout under ~/.rowboat/cache/:
//   blobs/<hash>            the bytes
//   blobs/<hash>.json       { mime }  (the org's stored verdict at fetch time)
//   blob-files/<hash>/<name>  named copies for tools that detect type by
//                             extension (parseFile, LLMParse)

const blobsDir = path.join(WorkDir, 'cache', 'blobs');
const blobFilesDir = path.join(WorkDir, 'cache', 'blob-files');

const HASH_RE = /^[0-9a-f]{64}$/;

function assertHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error(`not a blob hash: ${hash}`);
}

async function writeAtomic(finalPath: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const tmp = path.join(path.dirname(finalPath), `.tmp-${randomBytes(8).toString('hex')}`);
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, finalPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export interface CachedBlob {
  bytes: Uint8Array;
  mime: string;
}

/** The read-through: local cache first, the org (via the authed client) on a miss. */
export async function getBlob(orgId: string, spaceId: string, hash: string): Promise<CachedBlob> {
  assertHash(hash);
  const blobPath = path.join(blobsDir, hash);
  try {
    const bytes = await fs.readFile(blobPath);
    // Integrity: a torn write or disk corruption must never serve wrong bytes
    // under a content address — verify cheap (local read) and refetch on fail.
    if (createHash('sha256').update(bytes).digest('hex') === hash) {
      const meta = await fs.readFile(`${blobPath}.json`, 'utf8').then(
        (raw) => JSON.parse(raw) as { mime?: string },
        () => ({}) as { mime?: string },
      );
      return { bytes, mime: meta.mime ?? 'application/octet-stream' };
    }
    await fs.rm(blobPath, { force: true });
  } catch {
    // miss — fall through to the network
  }
  const fetched = await orgs.getClient(orgId).fetchBlob(spaceId, hash);
  await seedBlob(fetched.bytes, fetched.mime);
  return { bytes: fetched.bytes, mime: fetched.mime };
}

/**
 * Warm the cache with bytes already in hand (an upload's payload, with the
 * org's mime verdict) so the next render or download never re-fetches.
 */
export async function seedBlob(bytes: Uint8Array, mime: string): Promise<string> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const blobPath = path.join(blobsDir, hash);
  await writeAtomic(blobPath, bytes);
  await writeAtomic(`${blobPath}.json`, new TextEncoder().encode(JSON.stringify({ mime })));
  return hash;
}

/**
 * A named on-disk copy of a cached blob for extension-sniffing consumers
 * (parseFile/LLMParse detect format from the filename). Content-addressed
 * parent directory, so the same name can exist for different blobs and a
 * re-download is a free overwrite of identical bytes. The caller picks the
 * filename (it knows the display name and the mime); bytes come from getBlob.
 */
export async function writeBlobFile(hash: string, filename: string, bytes: Uint8Array): Promise<string> {
  assertHash(hash);
  const filePath = path.join(blobFilesDir, hash, filename);
  await writeAtomic(filePath, bytes);
  return filePath;
}
