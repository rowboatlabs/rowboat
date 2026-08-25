import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blobHash, type BlobStore } from '../src/blobs.js';
import { DiskBlobStore } from '../src/blobs-disk.js';
import { S3BlobStore } from '../src/blobs-s3.js';

// One conformance suite, every driver. Disk always runs (hermetic). The S3
// driver runs the IDENTICAL suite when a test bucket is configured:
//   HARBOR_TEST_S3_BUCKET=...      (required to enable)
//   HARBOR_TEST_S3_ENDPOINT=...    (optional — MinIO/R2)
//   HARBOR_TEST_S3_REGION=...      (optional)
// plus credentials via the standard AWS env/provider chain. Without the
// bucket env the S3 rows are skipped, not silently passed.

interface DriverCase {
  name: string;
  make(): Promise<{ store: BlobStore; cleanup(): Promise<void> }>;
}

const drivers: DriverCase[] = [
  {
    name: 'disk',
    async make() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-blobs-'));
      return {
        store: new DiskBlobStore(dir),
        cleanup: () => fs.rm(dir, { recursive: true, force: true }),
      };
    },
  },
];

const s3Bucket = process.env.HARBOR_TEST_S3_BUCKET;
if (s3Bucket) {
  drivers.push({
    name: 's3',
    async make() {
      const store = new S3BlobStore({
        bucket: s3Bucket,
        prefix: `harbor-test-${Date.now().toString(36)}/`,
        ...(process.env.HARBOR_TEST_S3_ENDPOINT ? { endpoint: process.env.HARBOR_TEST_S3_ENDPOINT, forcePathStyle: true } : {}),
        ...(process.env.HARBOR_TEST_S3_REGION ? { region: process.env.HARBOR_TEST_S3_REGION } : {}),
      });
      return { store, cleanup: async () => {} }; // test blobs are deleted by the suite itself
    },
  });
}

describe.each(drivers.map((d) => [d.name, d] as const))('blob store conformance (%s)', (_name, driver) => {
  let store: BlobStore;
  let cleanup: () => Promise<void>;
  const written: string[] = [];

  beforeAll(async () => {
    ({ store, cleanup } = await driver.make());
  });

  afterAll(async () => {
    await Promise.all(written.map((h) => store.delete(h).catch(() => {})));
    await cleanup();
  });

  async function put(bytes: Uint8Array): Promise<string> {
    const hash = await store.put(bytes);
    written.push(hash);
    return hash;
  }

  it('put returns the sha256 address and round-trips the bytes', async () => {
    const bytes = new TextEncoder().encode('# Design\nattached for the record\n');
    const hash = await put(bytes);
    expect(hash).toBe(blobHash(bytes));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from((await store.get(hash))!)).toEqual(Buffer.from(bytes));
  });

  it('binary bytes survive exactly (no text-encoding damage)', async () => {
    const bytes = randomBytes(64 * 1024); // includes invalid-UTF8 sequences with near certainty
    const hash = await put(bytes);
    expect(Buffer.from((await store.get(hash))!)).toEqual(bytes);
  });

  it('double put is an idempotent no-op with the same address', async () => {
    const bytes = new TextEncoder().encode('same bytes twice');
    const first = await put(bytes);
    const second = await store.put(bytes);
    expect(second).toBe(first);
    expect(await store.has(first)).toBe(true);
  });

  it('has/get on an absent blob are false/undefined, not errors', async () => {
    const absent = blobHash(new TextEncoder().encode('never stored'));
    expect(await store.has(absent)).toBe(false);
    expect(await store.get(absent)).toBeUndefined();
  });

  it('delete removes the blob; deleting a missing blob is fine', async () => {
    const hash = await store.put(new TextEncoder().encode('short-lived'));
    expect(await store.has(hash)).toBe(true);
    await store.delete(hash);
    expect(await store.has(hash)).toBe(false);
    await store.delete(hash); // second delete must not throw
  });

  it('empty blob is storable and addressable', async () => {
    const hash = await put(new Uint8Array(0));
    expect(hash).toBe(blobHash(new Uint8Array(0)));
    expect((await store.get(hash))!.byteLength).toBe(0);
  });

  // I/O-bound (1MB write + read + hash on shared CI disks) — the 5s default
  // flakes on starved runners; give it real headroom.
  it('a 1MB blob round-trips intact', { timeout: 30_000 }, async () => {
    const bytes = randomBytes(1024 * 1024);
    const hash = await put(bytes);
    expect(Buffer.from((await store.get(hash))!)).toEqual(bytes);
  });

  it('malformed addresses are rejected, never resolved', async () => {
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/not a blob hash/);
    await expect(store.get('abc')).rejects.toThrow(/not a blob hash/);
  });
});

if (!s3Bucket) {
  describe.skip('blob store conformance (s3 — set HARBOR_TEST_S3_BUCKET to enable)', () => {
    it('skipped', () => {});
  });
}
