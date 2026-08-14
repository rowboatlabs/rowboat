import { createHash } from 'node:crypto';

// The blob-store boundary (spec §6 Storage architecture): bytes for binary and
// large assets, keyed by their sha256, held OUTSIDE the database. Immutability
// plus hash keys shrink the whole contract to four methods — any object store
// can implement it. Two drivers ship: disk (blobs-disk.ts, self-hosted
// single-node) and S3-compatible (blobs-s3.ts, managed; also MinIO/R2/B2 via
// endpoint + forcePathStyle). Dedup scope is per deployment prefix/directory —
// per org, never global, when multi-org routing arrives.
//
// NOT yet wired to any route: the upload feature is deferred (spec §12) and
// lands as a contract PR adding the endpoint + a binary propose variant. This
// is the finished primitive that feature lands on.

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
}

/** Guards drivers against malformed addresses (and disk against path games). */
export function assertBlobHash(hash: string): void {
  if (!BLOB_HASH_RE.test(hash)) {
    throw new Error(`not a blob hash: ${hash}`);
  }
}
