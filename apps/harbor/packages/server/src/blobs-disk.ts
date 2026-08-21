import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertBlobHash, blobHash, type BlobStore } from './blobs.js';

// Disk driver: a plain directory with git-style two-char fan-out
// (<root>/ab/abcdef...). This is what keeps the self-hosted story at one
// docker-compose — Postgres plus a directory, no object-store dependency.
// Writes are temp-file + rename, so a crash never leaves a half-written blob
// under its final name, and concurrent puts of the same bytes are safe (the
// last rename wins with identical content).

export class DiskBlobStore implements BlobStore {
  constructor(private readonly rootDir: string) {}

  private pathFor(hash: string): string {
    assertBlobHash(hash);
    return path.join(this.rootDir, hash.slice(0, 2), hash);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = blobHash(bytes);
    const finalPath = this.pathFor(hash);
    if (await exists(finalPath)) return hash;
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    const tmpPath = path.join(path.dirname(finalPath), `.tmp-${randomBytes(8).toString('hex')}`);
    try {
      await fs.writeFile(tmpPath, bytes);
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true });
      throw err;
    }
    return hash;
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    try {
      return await fs.readFile(this.pathFor(hash));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async has(hash: string): Promise<boolean> {
    return exists(this.pathFor(hash));
  }

  async delete(hash: string): Promise<void> {
    await fs.rm(this.pathFor(hash), { force: true });
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
