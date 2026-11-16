#!/usr/bin/env -S npx tsx
import { readdir, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

// One-time, before the first build that carries migration 062 (one server,
// 2026-11-09) starts: blob bytes were stored under a per-org prefix —
// `blobs/<orgId>/<xx>/<hash>` on S3-family stores, `<BLOBS_DIR>/<orgId>/…` on
// disk — and the single server reads `blobs/<xx>/<hash>` and `<BLOBS_DIR>/…`.
// Keys are content hashes, so copying is idempotent and a hash present under
// two orgs is the same bytes. Nothing is deleted: the old prefixes stay until
// an operator removes them by hand after the release has settled.
//
//   BLOBS_S3_BUCKET=… [BLOBS_S3_ENDPOINT/REGION/FORCE_PATH_STYLE, credentials] npx tsx scripts/flatten-blobs.ts
//   BLOBS_DIR=/var/harbor/blobs npx tsx scripts/flatten-blobs.ts

const HASH = /^[0-9a-f]{64}$/;

async function s3(bucket: string): Promise<void> {
  const client = new S3Client({
    ...(process.env.BLOBS_S3_REGION ? { region: process.env.BLOBS_S3_REGION } : {}),
    ...(process.env.BLOBS_S3_ENDPOINT ? { endpoint: process.env.BLOBS_S3_ENDPOINT } : {}),
    ...(process.env.BLOBS_S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
    ...(process.env.BLOBS_S3_ACCESS_KEY_ID && process.env.BLOBS_S3_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: process.env.BLOBS_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BLOBS_S3_SECRET_ACCESS_KEY } }
      : {}),
  });
  let token: string | undefined;
  let copied = 0;
  let kept = 0;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'blobs/', ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      const parts = (object.Key ?? '').split('/');
      // blobs/<orgId>/<xx>/<hash>: four parts; the flat key has three.
      if (parts.length !== 4 || !HASH.test(parts[3]!)) continue;
      const hash = parts[3]!;
      const target = `blobs/${hash.slice(0, 2)}/${hash}`;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: target }));
        kept += 1;
        continue;
      } catch {
        // absent: copy
      }
      await client.send(new CopyObjectCommand({ Bucket: bucket, Key: target, CopySource: `${bucket}/${encodeURIComponent(object.Key!)}` }));
      copied += 1;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  console.log(`s3://${bucket}: copied ${copied} blobs to the flat prefix, ${kept} were already there`);
}

async function disk(root: string): Promise<void> {
  let moved = 0;
  let kept = 0;
  for (const org of await readdir(root)) {
    const orgDir = path.join(root, org);
    if (!(await stat(orgDir)).isDirectory() || /^[0-9a-f]{2}$/.test(org)) continue; // a flat shard, not an org
    for (const shard of await readdir(orgDir)) {
      const shardDir = path.join(orgDir, shard);
      if (!(await stat(shardDir)).isDirectory()) continue;
      for (const file of await readdir(shardDir)) {
        if (!HASH.test(file)) continue;
        const target = path.join(root, shard, file);
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await stat(target);
          kept += 1;
        } catch {
          await rename(path.join(shardDir, file), target);
          moved += 1;
        }
      }
    }
  }
  console.log(`${root}: moved ${moved} blobs to the flat layout, ${kept} were already there`);
}

const bucket = process.env.BLOBS_S3_BUCKET;
const dir = process.env.BLOBS_DIR;
if (bucket) await s3(bucket);
else if (dir) await disk(dir);
else {
  console.error('set BLOBS_S3_BUCKET or BLOBS_DIR');
  process.exit(2);
}
