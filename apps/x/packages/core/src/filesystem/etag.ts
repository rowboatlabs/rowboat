import fs from 'node:fs/promises';

/**
 * The transactional write guard shared by every guarded file write
 * (filesystem/files.ts writeText/writeBuffer and workspace/workspace.ts
 * writeFile). A caller that read the file at etag E and asks to write with
 * `expectedEtag: E` is promising "only if nobody else wrote in between" —
 * the check runs under the per-path file lock, so there is no window.
 */

/** `${size}:${mtimeMs}` — the file identity a read reports and a guarded write verifies. */
export function computeEtag(size: number, mtimeMs: number): string {
  return `${size}:${mtimeMs}`;
}

/**
 * A guarded write was refused: the file on disk is not the one the caller
 * read. `reason` says how — it CHANGED (someone wrote it) or it is MISSING
 * (someone deleted or moved it). Both are the same contract violation: the
 * caller's picture of the file is stale, and writing would either clobber a
 * newer version or silently resurrect a file the user removed. Consumers key
 * on `instanceof` in-process and on the 'ETag mismatch' marker across IPC
 * (renderer file-sync), so the marker must stay in BOTH messages.
 */
export class EtagMismatchError extends Error {
  readonly code = 'ETAG_MISMATCH';
  readonly reason: 'changed' | 'missing';

  constructor(reason: 'changed' | 'missing') {
    super(reason === 'missing'
      ? 'File no longer exists (ETag mismatch)'
      : 'File was modified (ETag mismatch)');
    this.name = 'EtagMismatchError';
    this.reason = reason;
  }
}

export function isEtagMismatchError(err: unknown): err is EtagMismatchError {
  return err instanceof EtagMismatchError;
}

/**
 * Throws EtagMismatchError unless the file at `absPath` currently has
 * `expectedEtag`. A missing file is a mismatch ('missing'), never a raw
 * ENOENT: the caller read a file that no longer exists, which is exactly the
 * conflict the guard exists to surface. Must be called under the file lock.
 */
export async function assertEtagMatches(absPath: string, expectedEtag: string): Promise<void> {
  let stats;
  try {
    stats = await fs.lstat(absPath);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new EtagMismatchError('missing');
    }
    throw err;
  }
  if (computeEtag(stats.size, stats.mtimeMs) !== expectedEtag) {
    throw new EtagMismatchError('changed');
  }
}
