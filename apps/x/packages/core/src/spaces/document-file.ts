import { createHash } from 'node:crypto';
import path from 'node:path';
import { getClient } from './orgs.js';
import { getBlob, writeBlobFile } from './blob-cache.js';

/** Immutable named snapshot for parsers that require a filesystem path. */
export async function materializeDocument(orgId: string, spaceId: string, assetPath: string, version: number): Promise<string> {
    const asset = await getClient(orgId).readAsset(spaceId, assetPath, version);
    const bytes = asset.blob
        ? (await getBlob(orgId, spaceId, asset.blob.hash)).bytes
        : Buffer.from(asset.content, 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    return writeBlobFile(hash, path.basename(assetPath), bytes);
}

/** Message attachments need no asset entry to use the same document parsers. */
export async function materializeAttachment(orgId: string, spaceId: string, hash: string, name: string): Promise<string> {
    const { bytes } = await getBlob(orgId, spaceId, hash);
    return writeBlobFile(hash, path.basename(name), bytes);
}
