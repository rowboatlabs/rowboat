import fs from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import { WorkDir } from "@x/core/dist/config/config.js";
import * as blobCache from "@x/core/dist/spaces/blob-cache.js";
import { serverHostMode, whenServerReady } from "../server-host.js";

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

/**
 * The read-through: local cache first, the org (via the authed client) on a
 * miss. With a remote server (a Baarali cloud instance, 2026-10-02) the org
 * registry is the server's, not this machine's: the bytes come from its
 * /spaces/blob route, and Chromium keeps them (content-addressed, immutable).
 */
export async function getBlob(orgId: string, spaceId: string, hash: string): Promise<CachedBlob> {
  if (serverHostMode() !== "remote") return blobCache.getBlob(orgId, spaceId, hash);
  assertHash(hash);
  const { baseUrl, key } = await whenServerReady();
  const res = await fetch(`${baseUrl}/spaces/blob/${[orgId, spaceId, hash].map(encodeURIComponent).join("/")}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`space blob ${hash} unavailable (${res.status})`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "application/octet-stream",
  };
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
