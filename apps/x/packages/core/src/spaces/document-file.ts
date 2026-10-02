import { createHash } from 'node:crypto';
import path from 'node:path';
import { getClient } from './orgs.js';
import { getBlob, writeBlobFile } from './blob-cache.js';

/**
 * Immutable named snapshot for parsers that require a filesystem path. The
 * file is read by asset id; the on-disk name is the record's path basename
 * (parsers sniff the extension).
 */
export async function materializeDocument(orgId: string, spaceId: string, assetId: string, version: number): Promise<string> {
    const asset = await getClient(orgId).readAsset(spaceId, assetId, version);
    const bytes = asset.blob
        ? (await getBlob(orgId, spaceId, asset.blob.hash)).bytes
        : Buffer.from(asset.content, 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    return writeBlobFile(hash, path.basename(asset.path), bytes);
}

/** Message attachments need no asset entry to use the same document parsers. */
export async function materializeAttachment(orgId: string, spaceId: string, hash: string, name: string): Promise<string> {
    const { bytes } = await getBlob(orgId, spaceId, hash);
    return writeBlobFile(hash, path.basename(name), bytes);
}
