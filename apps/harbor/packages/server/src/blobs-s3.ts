import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertBlobHash, blobHash, type BlobStore } from './blobs.js';

// S3-compatible driver via the canonical AWS SDK. "S3-compatible" is the
// de-facto universal object protocol — MinIO, Cloudflare R2, Backblaze B2,
// and GCS interop all speak it — reached here through `endpoint` +
// `forcePathStyle`. Credentials resolve through the SDK's standard provider
// chain (env, profile, instance role) unless passed explicitly.

export interface S3BlobStoreOptions {
  bucket: string;
  /** Key prefix inside the bucket; default 'blobs/'. Per-org prefixes scope dedup when multi-org arrives. */
  prefix?: string;
  region?: string;
  /** Non-AWS endpoints (MinIO, R2, B2). */
  endpoint?: string;
  /** Required by MinIO and most self-hosted S3 implementations. */
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3BlobStoreOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? 'blobs/';
    this.client = new S3Client({
      ...(options.region ? { region: options.region } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });
  }

  private keyFor(hash: string): string {
    assertBlobHash(hash);
    return `${this.prefix}${hash.slice(0, 2)}/${hash}`;
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = blobHash(bytes);
    // Existence check first: skips re-uploading large bodies. A lost race is
    // harmless — overwriting a content-addressed key rewrites identical bytes.
    if (await this.has(hash)) return hash;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(hash),
        Body: bytes,
        ContentType: 'application/octet-stream',
        // Immutable by construction; let every cache keep it forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return hash;
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(hash) }),
      );
      if (!res.Body) return undefined;
      return await res.Body.transformToByteArray();
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
  }

  async has(hash: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.keyFor(hash) }));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async delete(hash: string): Promise<void> {
    // S3 DeleteObject is idempotent — deleting a missing key succeeds.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.keyFor(hash) }));
  }

  /** Presigned GET — the serving route 302s here so bytes go S3 → client directly. */
  async downloadUrl(
    hash: string,
    opts: { expiresInSeconds: number; responseContentType?: string; responseContentDisposition?: string },
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.keyFor(hash),
      // Objects are stored as octet-stream (put); the org's stored mime and
      // disposition are re-asserted here, inside the signature.
      ...(opts.responseContentType ? { ResponseContentType: opts.responseContentType } : {}),
      ...(opts.responseContentDisposition
        ? { ResponseContentDisposition: opts.responseContentDisposition }
        : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: opts.expiresInSeconds });
  }
}

function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}
