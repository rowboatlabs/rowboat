import fs from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import { WorkDir } from "@x/core/dist/config/config.js";
import * as blobCache from "@x/core/dist/spaces/blob-cache.js";

// Main's view of the space-blob cache. The content-addressed read-through
// itself lives in core (spaces/blob-cache.ts) — shared with the agent's
// spaces-download-blob tool — while the thumbnail layer stays here: it needs
// Electron's nativeImage, and we own the only client so the server ships no
// thumbnails. Cache keys inherit content-addressing.
//
//   ~/.rowboat/cache/thumbs/<hash>-<w>.png   nativeImage downscales, lazily

const thumbsDir = path.join(WorkDir, "cache", "thumbs");

const HASH_RE = /^[0-9a-f]{64}$/;

function assertHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error(`not a blob hash: ${hash}`);
}

export type CachedBlob = blobCache.CachedBlob;

/** The read-through: local cache first, the org (via the authed client) on a miss. */
export async function getBlob(orgId: string, spaceId: string, hash: string): Promise<CachedBlob> {
  return blobCache.getBlob(orgId, spaceId, hash);
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
  await fs.mkdir(thumbsDir, { recursive: true });
  const tmp = path.join(thumbsDir, `.tmp-${hash}-${w}-${Date.now().toString(36)}`);
  try {
    await fs.writeFile(tmp, png);
    await fs.rename(tmp, thumbPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return png;
}
