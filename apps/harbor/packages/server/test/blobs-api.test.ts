import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangeSet, ProposeChangeResult, ReadAssetResult } from '@rowboat/spaces-protocol';
import { blobHash } from '../src/blobs.js';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';

// The upload feature end to end over the render face: phase 1 (uploadBlob) +
// phase 2 (binary propose / serving), on both stores — the same dual gate as
// §11. The blob-store drivers have their own conformance suite (blobs.test.ts);
// here the memory driver stands in for "no presign" (stream path). The presign
// redirect is covered in blobs.test.ts's S3 rows and a URL-shape unit below.

// A real 1×1 PNG (sniffable magic bytes).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const CSV_BYTES = new TextEncoder().encode('week,signups\n1,40\n2,55\n');

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let spaceId: string;

function api(token: string) {
  const base = (extra: Record<string, string> = {}): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    ...extra,
  });
  return {
    async get(path: string) {
      const res = await fetch(`${harbor.url}${path}`, { headers: base(), redirect: 'manual' });
      const type = res.headers.get('content-type') ?? '';
      return {
        status: res.status,
        headers: res.headers,
        body: type.includes('application/json') ? await res.json() : new Uint8Array(await res.arrayBuffer()),
      } as { status: number; headers: Headers; body: any };
    },
    async post(path: string, body?: unknown) {
      const res = await fetch(`${harbor.url}${path}`, {
        method: 'POST',
        headers: base({ 'content-type': 'application/json' }),
        body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: (await res.json()) as any };
    },
    async putBlob(path: string, bytes: Uint8Array, headers: Record<string, string>) {
      const res = await fetch(`${harbor.url}${path}`, {
        method: 'PUT',
        headers: base(headers),
        body: bytes as unknown as BodyInit,
      });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

let ramnique: ReturnType<typeof api>;
let gagan: ReturnType<typeof api>;

describe.each([['memory'], ['postgres']] as const)('blob uploads over the render face (%s store)', (storeKind) => {
  beforeAll(async () => {
    const options: HarborOptions = {
      orgName: 'Blob Test Org',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
    };
    if (storeKind === 'postgres') {
      sqlDb = await pgliteDb();
      const store = new PgStore(sqlDb);
      await store.init();
      options.store = store;
    }
    harbor = await startHarbor(options);
    ramnique = api('dev-ramnique');
    gagan = api('dev-gagan');
    // Ramnique-only space: gagan is an org member but NOT a space member.
    const created = await ramnique.post('/v1/spaces', { name: 'Uploads' });
    spaceId = created.body.space.id;
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  // --- phase 1: uploadBlob ---------------------------------------------------

  it('uploads bytes and returns {hash, size, mime} — png sniffed regardless of declared type', async () => {
    const r = await ramnique.putBlob(`/v1/spaces/${spaceId}/blobs`, PNG_1PX, {
      'x-blob-sha256': blobHash(PNG_1PX),
      'content-type': 'application/octet-stream', // wrong on purpose; sniff wins
    });
    expect(r.status).toBe(200);
    expect(r.body.blob).toEqual({ hash: blobHash(PNG_1PX), size: PNG_1PX.byteLength, mime: 'image/png' });
  });

  it('re-uploading the same bytes is an idempotent no-op with the same address', async () => {
    const r = await ramnique.putBlob(`/v1/spaces/${spaceId}/blobs`, PNG_1PX, {
      'x-blob-sha256': blobHash(PNG_1PX),
      'content-type': 'image/png',
    });
    expect(r.status).toBe(200);
    expect(r.body.blob.hash).toBe(blobHash(PNG_1PX));
  });

  it('unsniffable bytes fall back to the declared content-type, else octet-stream', async () => {
    const declared = await ramnique.putBlob(`/v1/spaces/${spaceId}/blobs`, CSV_BYTES, {
      'x-blob-sha256': blobHash(CSV_BYTES),
      'content-type': 'text/csv; charset=utf-8',
    });
    expect(declared.status).toBe(200);
    expect(declared.body.blob.mime).toBe('text/csv');

    const bare = new TextEncoder().encode('no declared type either');
    const fallback = await ramnique.putBlob(`/v1/spaces/${spaceId}/blobs`, bare, {
      'x-blob-sha256': blobHash(bare),
    });
    expect(fallback.status).toBe(200);
    expect(fallback.body.blob.mime).toBe('application/octet-stream');
  });

  it('refuses a missing or mismatched x-blob-sha256 (nothing stored under a healthy name)', async () => {
    const missing = await ramnique.putBlob(`/v1/spaces/${spaceId}/blobs`, CSV_BYTES, {});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('invalid_request');

    const mismatched = await ramnique.putBlob(`/v1/spaces/${spaceId}/blobs`, CSV_BYTES, {
      'x-blob-sha256': blobHash(PNG_1PX), // right shape, wrong bytes
    });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.message).toMatch(/mismatch/);
  });

  it('non-members cannot upload to the space', async () => {
    const r = await gagan.putBlob(`/v1/spaces/${spaceId}/blobs`, CSV_BYTES, {
      'x-blob-sha256': blobHash(CSV_BYTES),
    });
    expect(r.status).toBe(403);
  });

  // --- serving ---------------------------------------------------------------

  it('serves an image inline with its stored mime and immutable caching', async () => {
    const r = await ramnique.get(`/v1/spaces/${spaceId}/blobs/${blobHash(PNG_1PX)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('content-disposition')).toBe('inline');
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(r.body as Uint8Array)).toEqual(PNG_1PX);
  });

  it('serves non-images as attachment, with the ?name= filename sanitized', async () => {
    const r = await ramnique.get(
      `/v1/spaces/${spaceId}/blobs/${blobHash(CSV_BYTES)}?name=${encodeURIComponent('../we"ird/signups.csv')}`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="..-weird-signups.csv"');
  });

  it('unknown hashes are not_found; non-members are refused; other spaces cannot see the blob', async () => {
    const absent = blobHash(new TextEncoder().encode('never uploaded'));
    expect((await ramnique.get(`/v1/spaces/${spaceId}/blobs/${absent}`)).status).toBe(404);
    expect((await gagan.get(`/v1/spaces/${spaceId}/blobs/${blobHash(PNG_1PX)}`)).status).toBe(403);

    // Same org, different space: bytes dedup underneath, but the space
    // registry is the read gate — the hash is not_found over there.
    const other = await ramnique.post('/v1/spaces', { name: 'Other Space' });
    const r = await ramnique.get(`/v1/spaces/${other.body.space.id}/blobs/${blobHash(PNG_1PX)}`);
    expect(r.status).toBe(404);
  });

  // --- phase 2: the binary propose variant -----------------------------------

  it('creates a binary asset at a nested path; change-set, listing, and read all carry blob metadata', async () => {
    const propose = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/screens/home.png',
      baseVersion: 0,
      blob: blobHash(PNG_1PX),
      reason: 'first mockup',
      actingMode: 'direct',
    });
    expect(propose.status).toBe(200);
    expect(propose.body.outcome).toBe('applied');
    const changeSet = propose.body.changeSet as ChangeSet;
    expect(changeSet.blob).toEqual({ hash: blobHash(PNG_1PX), size: PNG_1PX.byteLength, mime: 'image/png' });

    const listing = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    const entry = listing.body.entries.find((e: { path: string }) => e.path === 'design/screens/home.png');
    expect(entry.blob.mime).toBe('image/png');

    const read = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('design/screens/home.png')}`);
    const asset = read.body as ReadAssetResult;
    expect(asset.content).toBe('');
    expect(asset.blob?.hash).toBe(blobHash(PNG_1PX));
    expect(asset.version).toBe(1);
  });

  it('rejects proposing a hash that was never uploaded to this space', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/ghost.png',
      baseVersion: 0,
      blob: blobHash(new TextEncoder().encode('phantom bytes')),
      actingMode: 'direct',
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not uploaded/);
  });

  it('rejects a propose carrying both newContent and blob, or neither', async () => {
    const both = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/confused.png',
      baseVersion: 0,
      newContent: 'text',
      blob: blobHash(PNG_1PX),
      actingMode: 'direct',
    });
    expect(both.status).toBe(400);
    const neither = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/confused.png',
      baseVersion: 0,
      actingMode: 'direct',
    });
    expect(neither.status).toBe(400);
  });

  it('replaces at the current base; stale binary proposes are conflict-or-replace with empty regions', async () => {
    // v2: replace the image with the csv bytes (content-addressing does not care).
    const replace = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/screens/home.png',
      baseVersion: 1,
      blob: blobHash(CSV_BYTES),
      reason: 'swap in the data placeholder',
      actingMode: 'direct',
    });
    expect(replace.body.outcome).toBe('applied');
    expect(replace.body.version).toBe(2);

    // A stale binary propose (base v1, head v2): nothing to three-way-merge.
    const stale = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/screens/home.png',
      baseVersion: 1,
      blob: blobHash(PNG_1PX),
      actingMode: 'direct',
    });
    expect(stale.status).toBe(200);
    expect(stale.body.outcome).toBe('conflict');
    expect(stale.body.regions).toEqual([]);
    expect(stale.body.currentContent).toBe('');
    expect(stale.body.currentBlob).toEqual({ hash: blobHash(CSV_BYTES), size: CSV_BYTES.byteLength, mime: 'text/csv' });
    expect(stale.body.currentVersion).toBe(2);

    // Re-proposing at the current version is the explicit replace.
    const replay = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/screens/home.png',
      baseVersion: 2,
      blob: blobHash(PNG_1PX),
      actingMode: 'direct',
    });
    expect(replay.body.outcome).toBe('applied');
    expect(replay.body.version).toBe(3);
  });

  it('a stale TEXT propose against a binary head also conflicts instead of merging', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/screens/home.png',
      baseVersion: 1,
      newContent: 'not really an image',
      actingMode: 'direct',
    });
    expect(r.body.outcome).toBe('conflict');
    expect(r.body.regions).toEqual([]);
    expect(r.body.currentBlob?.hash).toBe(blobHash(PNG_1PX)); // v3 head
  });

  it('time-travel reads return each version’s own blob; diff degrades to a readable binary stub', async () => {
    const v1 = await ramnique.get(
      `/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('design/screens/home.png')}&version=1`,
    );
    expect((v1.body as ReadAssetResult).blob?.mime).toBe('image/png');
    const v2 = await ramnique.get(
      `/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('design/screens/home.png')}&version=2`,
    );
    expect((v2.body as ReadAssetResult).blob?.mime).toBe('text/csv');

    const diff = await ramnique.get(
      `/v1/spaces/${spaceId}/diff?path=${encodeURIComponent('design/screens/home.png')}&from=1&to=2`,
    );
    expect(diff.status).toBe(200);
    expect(diff.body.unified).toContain('Binary change — no text diff.');
  });

  it('text assets are untouched by all of this: create, merge, and history still work beside binaries', async () => {
    const create = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'design/README.md',
      baseVersion: 0,
      newContent: '# Design\n\nMocks live under screens/.\n',
      actingMode: 'direct',
    });
    expect(create.body.outcome).toBe('applied');
    expect(create.body.changeSet.blob).toBeUndefined();

    const history = await ramnique.get(`/v1/spaces/${spaceId}/history`);
    const changeSets = history.body.changeSets as ChangeSet[];
    const binary = changeSets.filter((cs) => cs.blob !== undefined);
    expect(binary.length).toBeGreaterThanOrEqual(3); // v1..v3 of home.png
    expect(changeSets.some((cs) => cs.assetPath === 'design/README.md' && cs.blob === undefined)).toBe(true);
  });
});

describe('upload size cap', () => {
  it('refuses a body over maxBlobBytes with payload_too_large', async () => {
    const small = await startHarbor({
      orgName: 'Tiny Cap Org',
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
      maxBlobBytes: 16,
    });
    try {
      const headers = { authorization: 'Bearer dev-ramnique' };
      const created = await fetch(`${small.url}/v1/spaces`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Capped' }),
      }).then((r) => r.json() as Promise<{ space: { id: string } }>);
      const over = new TextEncoder().encode('these bytes exceed sixteen');
      const res = await fetch(`${small.url}/v1/spaces/${created.space.id}/blobs`, {
        method: 'PUT',
        headers: { ...headers, 'x-blob-sha256': blobHash(over) },
        body: over as unknown as BodyInit,
      });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe('payload_too_large');
    } finally {
      await small.close();
    }
  });
});

describe('presigned downloads (S3 driver, offline URL shape)', () => {
  it('mints a signed URL carrying the org’s response headers inside the signature', async () => {
    const { S3BlobStore } = await import('../src/blobs-s3.js');
    const store = new S3BlobStore({
      bucket: 'harbor-test',
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIA_TEST', secretAccessKey: 'test-secret' },
    });
    const hash = blobHash(PNG_1PX);
    const url = await store.downloadUrl(hash, {
      expiresInSeconds: 300,
      responseContentType: 'image/png',
      responseContentDisposition: 'inline',
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toContain(hash);
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(parsed.searchParams.get('response-content-type')).toBe('image/png');
    expect(parsed.searchParams.get('response-content-disposition')).toBe('inline');
  });
});
