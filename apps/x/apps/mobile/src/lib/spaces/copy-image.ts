import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';

import { parseBlobLink } from '@/components/space-blob-image';
import type { SpacesClient } from '@/lib/spaces/client';

// Copying an image out of a message (2026-11-04). The bytes sit behind the
// authed blob route, so fetch them with the bearer and hand the clipboard the
// image itself: pasted anywhere, it's a picture, not a link only members open.

export interface MessageImage {
  host: string;
  spaceId: string;
  hash: string;
}

/** The uploaded images in a message body (`![name](https://<org>/s/<space>/b/<hash>?…)`), in order. */
export function messageImages(body: string): MessageImage[] {
  const images: MessageImage[] = [];
  for (const match of body.matchAll(/!\[[^\]]*\]\((\S+?)\)/g)) {
    const link = parseBlobLink(match[1]!);
    if (link && !images.some((i) => i.hash === link.hash)) images.push({ host: link.host, spaceId: link.spaceId, hash: link.hash });
  }
  return images;
}

export async function copyBlobImage(client: SpacesClient, spaceId: string, hash: string): Promise<void> {
  const { bytes } = await client.fetchBlob(spaceId, hash);
  const file = new File(Paths.cache, `copy-${hash}`);
  file.create({ overwrite: true });
  file.write(bytes);
  await Clipboard.setImageAsync(await file.base64());
}
