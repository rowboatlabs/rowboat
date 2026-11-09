import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { SpacesClient } from '@/lib/spaces/client';

// Opening an attached file from a message (2026-10-05). The server serves blobs
// to members only, so a browser can't follow the link: fetch the bytes with
// the bearer, drop them in the cache under the file's own name, and hand them
// to the iOS share sheet — Quick Look, Save to Files, open in another app.

/** `…/s/<space>/b/<hash>?name=<file name>` → the name, made safe as a file name. */
export function blobLinkName(url: string, fallback: string): string {
  let name = fallback;
  try {
    name = new URL(url).searchParams.get('name') ?? fallback;
  } catch {
    // keep the fallback
  }
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || fallback;
}

// Videos play in the app (2026-11-07): the share sheet could save one but
// never play it. Only containers AVPlayer and ExoPlayer both open.
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v']);

export function isVideoName(name: string): boolean {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext !== undefined && VIDEO_EXTENSIONS.has(ext);
}

/**
 * A blob as a local file, downloaded natively (a video can be large, so the
 * bytes never pass through JS). The blob route doesn't serve byte ranges, which
 * AVPlayer needs to stream, so a video plays from this file. Blobs are
 * content-addressed: a file already cached under its hash is the same bytes.
 */
export async function downloadBlob(org: string, spaceId: string, hash: string, name: string, token: string): Promise<File> {
  const dir = new Directory(Paths.cache, 'blobs', hash);
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  if (file.exists && file.size > 0) return file;
  return File.downloadFileAsync(`https://${org}/v1/spaces/${encodeURIComponent(spaceId)}/blobs/${hash}`, file, {
    headers: { authorization: `Bearer ${token}` },
    idempotent: true,
  });
}

export async function shareFile(file: File, mime: string | undefined, name: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Opening files is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}

export async function openBlobFile(client: SpacesClient, spaceId: string, hash: string, name: string): Promise<void> {
  const { bytes, mime } = await client.fetchBlob(spaceId, hash);
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(bytes);
  await shareFile(file, mime, name);
}
