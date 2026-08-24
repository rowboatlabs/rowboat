import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import { WorkDir } from "@x/core/dist/config/config.js";
import * as orgs from "@x/core/dist/spaces/orgs.js";

// Content-addressed local cache for space blobs. The address IS the sha256 of
// the bytes, so a cache hit is correct forever — no invalidation problem
// exists. Each blob downloads once per machine; the app:// protocol handler
// (main.ts) and the save-dialog IPC both read through here.
//
// Layout under ~/.rowboat/cache/:
//   blobs/<hash>            the bytes
//   blobs/<hash>.json       { mime }  (the org's stored verdict at fetch time)
//   thumbs/<hash>-<w>.png   nativeImage downscales, generated lazily
//
// Thumbnails are deliberately client-side (the server ships none): we own the
// only client, Electron's nativeImage needs no dependencies, and the cache
// keys inherit content-addressing.

const blobsDir = path.join(WorkDir, "cache", "blobs");
const thumbsDir = path.join(WorkDir, "cache", "thumbs");

const HASH_RE = /^[0-9a-f]{64}$/;

function assertHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error(`not a blob hash: ${hash}`);
}

async function writeAtomic(finalPath: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const tmp = path.join(path.dirname(finalPath), `.tmp-${randomBytes(8).toString("hex")}`);
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
    if (createHash("sha256").update(bytes).digest("hex") === hash) {
      const meta = await fs.readFile(`${blobPath}.json`, "utf8").then(
        (raw) => JSON.parse(raw) as { mime?: string },
        () => ({}) as { mime?: string },
      );
      return { bytes, mime: meta.mime ?? "application/octet-stream" };
    }
    await fs.rm(blobPath, { force: true });
  } catch {
    // miss — fall through to the network
  }
  const fetched = await orgs.getClient(orgId).fetchBlob(spaceId, hash);
  await writeAtomic(blobPath, fetched.bytes);
  await writeAtomic(`${blobPath}.json`, new TextEncoder().encode(JSON.stringify({ mime: fetched.mime })));
  return { bytes: fetched.bytes, mime: fetched.mime };
}

/**
 * A downscaled PNG for image blobs, cached by (hash, width). Returns null when
 * the bytes don't decode as an image — the caller falls back to the full blob.
 */
export async function getThumbnail(
  orgId: string,
  spaceId: string,
  hash: string,
  width: number,
): Promise<Uint8Array | null> {
  assertHash(hash);
  const w = Math.max(32, Math.min(1024, Math.round(width)));
  const thumbPath = path.join(thumbsDir, `${hash}-${w}.png`);
  try {
    return await fs.readFile(thumbPath);
  } catch {
    // generate below
  }
  const { bytes } = await getBlob(orgId, spaceId, hash);
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (size.width <= w) {
    // Already smaller than the ask — serve the original, skip a lossy resize.
    return bytes;
  }
  const png = image.resize({ width: w }).toPNG();
  await writeAtomic(thumbPath, png);
  return png;
}
