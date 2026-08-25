import { createHash } from 'node:crypto';

// The blob-store boundary (spec §6 Storage architecture): bytes for binary and
// large assets, keyed by their sha256, held OUTSIDE the database. Immutability
// plus hash keys shrink the whole contract to four methods — any object store
// can implement it. Two drivers ship: disk (blobs-disk.ts, self-hosted
// single-node) and S3-compatible (blobs-s3.ts, managed; also MinIO/R2/B2 via
// endpoint + forcePathStyle). Dedup scope is per deployment prefix/directory —
// per org, never global, when multi-org routing arrives.
//
// Wired (2026-08-24): uploadBlob/getBlob routes (http.ts) + proposeChange's
// binary variant ride this primitive; space-level readability lives in the
// space_blobs registry (store.ts), never here.

export const BLOB_HASH_RE = /^[0-9a-f]{64}$/;

/** sha256 hex — the blob address. */
export function blobHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface BlobStore {
  /**
   * Store bytes, returning their sha256 address. Idempotent by construction —
   * the same bytes land on the same key, so retries and duplicate uploads are
   * free no-ops.
   */
  put(bytes: Uint8Array): Promise<string>;
  /** undefined when the blob is not present. */
  get(hash: string): Promise<Uint8Array | undefined>;
  has(hash: string): Promise<boolean>;
  /** GC only (refcount sweep, spec §12). Deleting a missing blob is fine. */
  delete(hash: string): Promise<void>;
  /**
   * Optional capability: a short-lived direct-download URL (S3 presigned).
   * When present, the serving route 302s to it and the bytes never transit
   * Harbor; when absent (disk, memory), the route streams via get(). The
   * response-* overrides ride inside the signed URL, so the redirect target
   * still serves with the org's authoritative headers.
   */
  downloadUrl?(
    hash: string,
    opts: { expiresInSeconds: number; responseContentType?: string; responseContentDisposition?: string },
  ): Promise<string>;
}

/** In-memory driver — tests and the dev stub (restart = clean slate, matching MemoryStore). */
export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array): Promise<string> {
    const hash = blobHash(bytes);
    this.blobs.set(hash, new Uint8Array(bytes));
    return hash;
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    assertBlobHash(hash);
    return this.blobs.get(hash);
  }

  async has(hash: string): Promise<boolean> {
    assertBlobHash(hash);
    return this.blobs.has(hash);
  }

  async delete(hash: string): Promise<void> {
    assertBlobHash(hash);
    this.blobs.delete(hash);
  }
}

/** Guards drivers against malformed addresses (and disk against path games). */
export function assertBlobHash(hash: string): void {
  if (!BLOB_HASH_RE.test(hash)) {
    throw new Error(`not a blob hash: ${hash}`);
  }
}
