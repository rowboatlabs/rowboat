import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// One rowboat-server per workdir, whoever hosts it (Electron main in the
// slice, the standalone entrypoint after the flip). Two hosts on one
// ~/.rowboat double-run schedulers and split-brain the session index, so the
// lock is acquired by the transport itself — not by individual entrypoints —
// and a live holder is a hard error, never a silent fallback.

const LOCK_FILE = 'server.lock';

export async function acquireWorkdirLock(workDir: string): Promise<() => Promise<void>> {
  const lockPath = path.join(workDir, LOCK_FILE);
  try {
    const existing = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
    if (Number.isFinite(existing) && existing !== process.pid) {
      try {
        process.kill(existing, 0); // throws ESRCH if the pid is gone
        throw new Error(
          `another rowboat-server host (pid ${existing}) already owns ${workDir} — refusing to split-brain`,
        );
      } catch (err) {
        // ESRCH = no such process (stale lock, take over). EPERM = the pid
        // exists but belongs to another user — still a live holder.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM') {
          throw new Error(
            `another rowboat-server host (pid ${existing}) already owns ${workDir} — refusing to split-brain`,
          );
        }
        if (code !== 'ESRCH') throw err;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(lockPath, String(process.pid));
  return async () => {
    // Only remove our own claim (a crashed-then-restarted host may have
    // re-written it).
    try {
      const current = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
      if (current === process.pid) await fs.rm(lockPath, { force: true });
    } catch {
      // already gone
    }
  };
}
