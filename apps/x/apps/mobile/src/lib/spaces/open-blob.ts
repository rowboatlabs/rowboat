import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { SpacesClient } from '@/lib/spaces/client';

// Opening an attached file from a message (2026-10-05). The org serves blobs
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

export async function openBlobFile(client: SpacesClient, spaceId: string, hash: string, name: string): Promise<void> {
  const { bytes, mime } = await client.fetchBlob(spaceId, hash);
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Opening files is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}
